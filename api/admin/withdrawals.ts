import type { VercelRequest, VercelResponse } from '@vercel/node';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users, withdrawals, accountLedger, demoCycles, deposits } from '../../db/schema';
import { requireAdmin } from '../../lib/auth';
import { ensureWithdrawalTables } from '../../lib/withdrawal-db';


export async function handleList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  await ensureWithdrawalTables();

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
  const rows = await db
    .select({
      id: withdrawals.id,
      amount: withdrawals.amount,
      currency: withdrawals.currency,
      status: withdrawals.status,
      destination: withdrawals.destination,
      adminNote: withdrawals.adminNote,
      createdAt: withdrawals.createdAt,
      reviewedAt: withdrawals.reviewedAt,
      userId: users.id,
      userEmail: users.email,
      userFullName: users.fullName,
    })
    .from(withdrawals)
    .innerJoin(users, eq(withdrawals.userId, users.id))
    .where(statusFilter ? eq(withdrawals.status, statusFilter as any) : undefined)
    .orderBy(desc(withdrawals.createdAt));

  return res.status(200).json({ withdrawals: rows });
}


export async function handleApprove(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  await ensureWithdrawalTables();

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'Withdrawal id is required.' });

  try {
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
      if (!existing) throw new Error('Withdrawal not found.');
      if (existing.status !== 'pending') throw new Error(`Withdrawal is already ${existing.status}.`);

      await tx.execute(sql`SELECT id FROM users WHERE id = ${existing.userId} FOR UPDATE`);

      const amount = Number(existing.amount);
      const demoMarker = String(existing.adminNote || '');

      if (demoMarker.startsWith('DEMO_SIMULATION:')) {
        const demoCycleId = demoMarker.slice('DEMO_SIMULATION:'.length);
        const [cycle] = await tx.select().from(demoCycles).where(eq(demoCycles.id, demoCycleId)).limit(1);
        if (!cycle || cycle.userId !== existing.userId) {
          throw new Error('The DEMO cycle linked to this withdrawal was not found.');
        }

        const demoBalance = Number(cycle.currentAmount);
        if (amount > demoBalance + 1e-8) {
          throw new Error(`Insufficient DEMO balance. Current DEMO balance is $${Math.max(0, demoBalance).toLocaleString()}.`);
        }

        const newDemoBalance = demoBalance - amount;
        const [updated] = await tx.update(withdrawals).set({
          status: 'approved',
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(withdrawals.id, id)).returning();

        await tx.update(demoCycles).set({
          currentAmount: newDemoBalance.toFixed(8),
          updatedAt: new Date(),
        }).where(eq(demoCycles.id, cycle.id));

        await tx.execute(sql`
          INSERT INTO "demo_cycle_points" ("demo_cycle_id", "value")
          VALUES (${cycle.id}, ${newDemoBalance.toFixed(8)})
        `);

        return updated;
      }

      // Normal (non-DEMO) withdrawals continue to use the real account ledger.
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


export async function handleReject(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  await ensureWithdrawalTables();

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'Withdrawal id is required.' });

  const [existing] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
  if (!existing) return res.status(404).json({ error: 'Withdrawal not found.' });
  if (existing.status !== 'pending') return res.status(409).json({ error: `Withdrawal is already ${existing.status}.` });

  const note = typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim() : null;
  const [updated] = await db.update(withdrawals).set({
    status: 'rejected',
    adminNote: note || existing.adminNote,
    reviewedBy: admin.id,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(withdrawals.id, id)).returning();

  return res.status(200).json({ withdrawal: updated });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = String(req.query.route || '').replace(/^\/+|\/+$/g, '');
  if (!route) return handleList(req,res);
  const m = route.match(/^([^/]+)\/(approve|reject)$/);
  if (!m) return res.status(404).json({ error: 'Not found' });
  req.query.id = m[1];
  return m[2] === 'approve' ? handleApprove(req,res) : handleReject(req,res);
}
