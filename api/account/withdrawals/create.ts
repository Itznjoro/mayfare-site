import type { VercelRequest, VercelResponse } from '@vercel/node';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { accountLedger, demoCycles, deposits, withdrawals } from '../../../db/schema';
import { requireAuth } from '../../../lib/auth';
import { ensureWithdrawalTables } from '../../../lib/withdrawal-db';

const MIN_WITHDRAWAL = 50;

function validDestination(network: string, address: string): boolean {
  if (network === 'TRC20') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  if (network === 'ERC20' || network === 'BEP20') return /^0x[a-fA-F0-9]{40}$/.test(address);
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  await ensureWithdrawalTables();

  const amount = Number(req.body?.amount);
  const network = String(req.body?.network || '').toUpperCase();
  const address = String(req.body?.address || '').trim();
  const confirmed = req.body?.confirmed === true;

  if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL) {
    return res.status(400).json({ error: `Minimum withdrawal is $${MIN_WITHDRAWAL} USDT.` });
  }
  if (!validDestination(network, address)) {
    return res.status(400).json({ error: 'Enter a valid wallet address for the selected network.' });
  }
  if (!confirmed) {
    return res.status(400).json({ error: 'Please confirm the withdrawal requirements.' });
  }

  try {
    // Lock the user row so two simultaneous requests cannot both pass the
    // balance check against the same available funds.
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${user.id} FOR UPDATE`);

      // During the DEMO, withdrawals are part of the simulation. They use the
      // DEMO cycle's current simulated amount and are marked so admin approval
      // can reduce the DEMO balance without creating a real ledger withdrawal.
      const [activeDemo] = await tx.select().from(demoCycles)
        .where(and(eq(demoCycles.userId, user.id), eq(demoCycles.status, 'active')))
        .limit(1);

      let balance = 0;
      let demoMarker: string | null = null;

      if (activeDemo) {
        balance = Number(activeDemo.currentAmount);
        demoMarker = `DEMO_SIMULATION:${activeDemo.id}`;
      } else {
        const ledgerRows = await tx
          .select({ type: accountLedger.type, amount: accountLedger.amount })
          .from(accountLedger)
          .where(eq(accountLedger.userId, user.id));
        const approvedRows = await tx
          .select({ amount: deposits.amount, status: deposits.status })
          .from(deposits)
          .where(eq(deposits.userId, user.id));
        const approvedDepositTotal = approvedRows
          .filter((row) => row.status === 'approved')
          .reduce((sum, row) => sum + Number(row.amount), 0);
        const nonDepositLedger = ledgerRows
          .filter((row) => row.type !== 'deposit')
          .reduce((sum, row) => sum + Number(row.amount), 0);
        balance = approvedDepositTotal + nonDepositLedger;
      }

      const pendingRows = await tx
        .select({ amount: withdrawals.amount, status: withdrawals.status, adminNote: withdrawals.adminNote })
        .from(withdrawals)
        .where(eq(withdrawals.userId, user.id));
      const pendingAmount = pendingRows
        .filter((row) => row.status === 'pending' && (demoMarker ? String(row.adminNote || '') === demoMarker : !String(row.adminNote || '').startsWith('DEMO_SIMULATION:')))
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const availableForRequest = balance - pendingAmount;

      if (amount > availableForRequest + 1e-8) {
        throw new Error(`Withdrawal exceeds your available balance of $${Math.max(0, availableForRequest).toLocaleString()}.`);
      }

      const [withdrawal] = await tx.insert(withdrawals).values({
        userId: user.id,
        amount: amount.toString(),
        currency: 'USDT',
        status: 'pending',
        destination: `${network}:${address}`,
        adminNote: demoMarker || null,
      }).returning();

      return withdrawal;
    });

    return res.status(201).json({ withdrawal: result });
  } catch (error) {
    console.error('Withdrawal request failed:', error);
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Could not create the withdrawal request.',
    });
  }
}
