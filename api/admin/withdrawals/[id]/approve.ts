import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { accountLedger, deposits, withdrawals } from '../../../../db/schema';
import { requireAdmin } from '../../../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'Withdrawal id is required.' });

  try {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
      if (!existing) throw new Error('Withdrawal not found.');
      if (existing.status !== 'pending') throw new Error(`Withdrawal is already ${existing.status}.`);

      await tx.execute(sql`SELECT id FROM users WHERE id = ${existing.userId} FOR UPDATE`);

      const ledgerRows = await tx
        .select({ type: accountLedger.type, amount: accountLedger.amount })
        .from(accountLedger)
        .where(eq(accountLedger.userId, existing.userId));
      const approvedRows = await tx
        .select({ amount: deposits.amount, status: deposits.status })
        .from(deposits)
        .where(eq(deposits.userId, existing.userId));
      const approvedDepositTotal = approvedRows
        .filter((row) => row.status === 'approved')
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const nonDepositLedger = ledgerRows
        .filter((row) => row.type !== 'deposit')
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const balance = approvedDepositTotal + nonDepositLedger;
      const amount = Number(existing.amount);

      if (amount > balance + 1e-8) {
        throw new Error(`Insufficient available balance. Current balance is $${Math.max(0, balance).toLocaleString()}.`);
      }

      const newBalance = balance - amount;
      const [updated] = await tx.update(withdrawals).set({
        status: 'approved',
        reviewedBy: admin.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(withdrawals.id, id)).returning();

      await tx.insert(accountLedger).values({
        userId: existing.userId,
        type: 'withdrawal',
        amount: (-amount).toString(),
        referenceTable: 'withdrawals',
        referenceId: existing.id,
        balanceAfter: newBalance.toString(),
      });

      return updated;
    });

    return res.status(200).json({ withdrawal: result });
  } catch (error) {
    console.error('Withdrawal approval failed:', error);
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Could not approve the withdrawal.' });
  }
}
