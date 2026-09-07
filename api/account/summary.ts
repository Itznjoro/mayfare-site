import type { VercelRequest, VercelResponse } from '@vercel/node';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { accountLedger, deposits } from '../../db/schema';
import { requireAuth } from '../../lib/auth';
import { getCurrentBalance } from '../../lib/ledger';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  const entries = await db
    .select()
    .from(accountLedger)
    .where(eq(accountLedger.userId, user.id))
    .orderBy(desc(accountLedger.createdAt));

  const balance = await getCurrentBalance(user.id);

  // Reconcile approved deposits that somehow lack a ledger row. This keeps
  // the client dashboard consistent with the admin-approved deposit state.
  const approvedDeposits = await db
    .select({ id: deposits.id, amount: deposits.amount, status: deposits.status })
    .from(deposits)
    .where(eq(deposits.userId, user.id));
  const approvedOnly = approvedDeposits.filter((d) => d.status === 'approved');
  const ledgerDepositIds = new Set(entries.map((e) => e.referenceId).filter(Boolean));
  const missingApprovedDepositCredit = approvedOnly
    .filter((d) => !ledgerDepositIds.has(d.id))
    .reduce((sum, d) => sum + parseFloat(d.amount), 0);
  const reconciledBalance = balance + missingApprovedDepositCredit;

  const recentEntries = entries.slice(0, 100);

  const ledgerDeposited = entries
    .filter((e: typeof entries[number]) => e.type === 'deposit')
    .reduce((sum: number, e: typeof entries[number]) => sum + parseFloat(e.amount), 0);
  const totalDeposited = ledgerDeposited + missingApprovedDepositCredit;

  const totalWithdrawn = entries
    .filter((e: typeof entries[number]) => e.type === 'withdrawal')
    .reduce((sum: number, e: typeof entries[number]) => sum + Math.abs(parseFloat(e.amount)), 0);

  const totalRealizedPnl = entries
    .filter((e: typeof entries[number]) => e.type === 'realized_pnl')
    .reduce((sum: number, e: typeof entries[number]) => sum + parseFloat(e.amount), 0);

  // Shaped to plug directly into window.renderTransactions() and
  // window.renderRecents() on the frontend with no further transformation.
  const transactions = recentEntries.map((e: typeof entries[number]) => {
    const created = new Date(e.createdAt);
    const amountNum = parseFloat(e.amount);
    return {
      id: e.id,
      type: e.type === 'realized_pnl' ? 'return' : e.type,
      label: e.type === 'deposit' ? 'Deposit' : e.type === 'withdrawal' ? 'Withdrawal' : 'Return',
      date: created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      amountDisplay: (amountNum >= 0 ? '+' : '') + '$' + Math.abs(amountNum).toLocaleString(),
      netDisplay: '$' + parseFloat(e.balanceAfter).toLocaleString(),
      currency: 'USDT',
      note: e.referenceTable ? 'Ref: ' + e.referenceTable : '',
    };
  });

  return res.status(200).json({
    balance: reconciledBalance,
    totalDeposited,
    totalWithdrawn,
    totalRealizedPnl,
    transactions,
  });
}
