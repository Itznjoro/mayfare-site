import type { VercelRequest, VercelResponse } from '@vercel/node';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { accountLedger, deposits, withdrawals } from '../../db/schema';
import { requireAuth } from '../../lib/auth';

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

  // Approved deposits are the authoritative deposit state. Include them directly
  // so the dashboard remains correct even if an older approval happened before
  // its ledger credit was written.
  const userWithdrawals = await db
    .select({ id: withdrawals.id, amount: withdrawals.amount, currency: withdrawals.currency, status: withdrawals.status, createdAt: withdrawals.createdAt })
    .from(withdrawals)
    .where(eq(withdrawals.userId, user.id));

  const approvedDeposits = await db
    .select({ id: deposits.id, amount: deposits.amount, status: deposits.status })
    .from(deposits)
    .where(eq(deposits.userId, user.id));
  const approvedOnly = approvedDeposits.filter((d) => d.status === 'approved');
  const approvedDepositTotal = approvedOnly.reduce((sum, d) => sum + Number(d.amount), 0);
  // Keep any non-deposit ledger activity (e.g. realized P/L) while using the
  // approved-deposit table as the deposit source of truth.
  const nonDepositLedger = entries
    .filter((e) => e.type !== 'deposit')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  const balance = approvedDepositTotal + nonDepositLedger;

  const totalDeposited = approvedDepositTotal;
  const totalWithdrawn = entries
    .filter((e) => e.type === 'withdrawal')
    .reduce((sum, e) => sum + Math.abs(Number(e.amount)), 0);
  const totalRealizedPnl = entries
    .filter((e) => e.type === 'realized_pnl')
    .reduce((sum, e) => sum + Number(e.amount), 0);
  // Include approved deposits in Recent Deposits even if an older approval
  // predates the ledger credit. Current approvals still create the ledger row.
  const ledgerDepositRefs = new Set(
    entries.filter((e) => e.type === 'deposit' && e.referenceId).map((e) => e.referenceId as string)
  );
  const syntheticDeposits = approvedOnly
    .filter((d) => !ledgerDepositRefs.has(d.id))
    .map((d) => ({
      id: 'deposit-' + d.id,
      type: 'deposit' as const,
      label: 'Deposit',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: '',
      amountDisplay: '+' + '$' + Number(d.amount).toLocaleString(),
      netDisplay: '$' + balance.toLocaleString(),
      currency: 'USDT',
      note: 'Ref: deposits',
      createdAt: Date.now(),
    }));

  // Shaped to plug directly into window.renderTransactions() and
  // window.renderRecents() on the frontend with no further transformation.
  const recentEntries = entries.slice(0, 100);
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

  // Include withdrawal requests that do not yet have a ledger entry (for example,
  // a newly submitted pending request). Once approved, the ledger entry is already
  // represented above, so do not duplicate it here.
  const ledgerWithdrawalRefs = new Set(
    entries.filter((e) => e.type === 'withdrawal' && e.referenceId).map((e) => e.referenceId as string)
  );
  const pendingOrUnledgeredWithdrawals = userWithdrawals
    .filter((w) => !ledgerWithdrawalRefs.has(w.id))
    .map((w) => {
      const created = new Date(w.createdAt);
      const statusLabel = w.status.charAt(0).toUpperCase() + w.status.slice(1);
      const amountNum = Number(w.amount);
      return {
        id: w.id,
        type: 'withdraw',
        label: 'Withdrawal',
        date: created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        amountDisplay: '-$' + amountNum.toLocaleString(),
        netDisplay: '$' + balance.toLocaleString(),
        currency: w.currency || 'USDT',
        note: 'Status: ' + statusLabel,
      };
    });

  // Keep withdrawal rows from the ledger visible, but use the frontend's
  // `withdraw` filter key rather than the database's `withdrawal` key.
  const normalizedTransactions = allTransactions.map((tx: any) =>
    tx.type === 'withdrawal' ? { ...tx, type: 'withdraw', label: 'Withdrawal', amountDisplay: '-' + tx.amountDisplay.replace(/^\+/, '') } : tx
  );
  const allTransactionsWithWithdrawals = normalizedTransactions.concat(pendingOrUnledgeredWithdrawals as any);
  allTransactionsWithWithdrawals.sort((a: any, b: any) => {
    const aTime = a.createdAt ? Number(a.createdAt) : Date.parse(a.date + ' ' + a.time);
    const bTime = b.createdAt ? Number(b.createdAt) : Date.parse(b.date + ' ' + b.time);
    return bTime - aTime;
  });

  return res.status(200).json({
    balance,
    totalDeposited,
    totalWithdrawn,
    totalRealizedPnl,
    transactions: allTransactionsWithWithdrawals,
  });
}
