import type { VercelRequest, VercelResponse } from '@vercel/node';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { accountLedger, deposits, withdrawals, demoCycles } from '../../db/schema';
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
  const totalRealizedPnl = entries
    .filter((e) => e.type === 'realized_pnl')
    .reduce((sum, e) => sum + Number(e.amount), 0);

  // DEMO cycle results are stored separately from the real account ledger.
  // Completed DEMO cycles remain available after the active cycle disappears,
  // so dashboard/profile/transactions can continue showing the earned return.
  const userDemoCycles = await db
    .select({
      id: demoCycles.id,
      startingAmount: demoCycles.startingAmount,
      currentAmount: demoCycles.currentAmount,
      status: demoCycles.status,
      completedAt: demoCycles.completedAt,
      updatedAt: demoCycles.updatedAt,
    })
    .from(demoCycles)
    .where(eq(demoCycles.userId, user.id));

  const activeDemoCycles = userDemoCycles.filter((c) => c.status === 'active').length;
  const completedDemoCycles = userDemoCycles.filter((c) => c.status === 'completed').length;
  const totalCompletedDemoProfit = userDemoCycles
    .filter((c) => c.status === 'completed')
    .reduce((sum, c) => sum + (Number(c.currentAmount) - Number(c.startingAmount)), 0);

  const totalWithdrawn = (await db
    .select({
      amount: withdrawals.amount,
      status: withdrawals.status,
    })
    .from(withdrawals)
    .where(eq(withdrawals.userId, user.id)))
    .filter((w) => w.status === 'approved' || w.status === 'completed')
    .reduce((sum, w) => sum + Math.abs(Number(w.amount)), 0);

  const totalProfit = totalRealizedPnl + totalCompletedDemoProfit;
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

  // Pending/approved/rejected/completed withdrawal requests are stored in
  // withdrawals. Approved/completed withdrawals that already have a ledger
  // entry are represented by that ledger row, so only add requests that are
  // not already represented there.
  const userWithdrawals = await db
    .select({
      id: withdrawals.id,
      amount: withdrawals.amount,
      currency: withdrawals.currency,
      status: withdrawals.status,
      createdAt: withdrawals.createdAt,
    })
    .from(withdrawals)
    .where(eq(withdrawals.userId, user.id));

  const ledgerWithdrawalRefs = new Set(
    entries
      .filter((e) => e.type === 'withdrawal' && e.referenceId)
      .map((e) => e.referenceId as string)
  );

  // Shaped to plug directly into window.renderTransactions() and
  // window.renderRecents() on the frontend with no further transformation.
  const recentEntries = entries.slice(0, 100);
  const transactions = recentEntries.map((e: typeof entries[number]) => {
    const created = new Date(e.createdAt);
    const amountNum = parseFloat(e.amount);
    return {
      id: e.id,
      type: e.type === 'realized_pnl' ? 'return' : e.type === 'withdrawal' ? 'withdraw' : e.type,
      label: e.type === 'deposit' ? 'Deposit' : e.type === 'withdrawal' ? 'Withdrawal' : 'Return',
      date: created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      amountDisplay: e.type === 'withdrawal'
        ? '-$' + Math.abs(amountNum).toLocaleString()
        : (amountNum >= 0 ? '+' : '') + '$' + Math.abs(amountNum).toLocaleString(),
      netDisplay: '$' + parseFloat(e.balanceAfter).toLocaleString(),
      currency: 'USDT',
      note: e.referenceTable ? 'Ref: ' + e.referenceTable : '',
      createdAt: created.getTime(),
    };
  });

  const withdrawalTransactions = userWithdrawals
    .filter((w) => !ledgerWithdrawalRefs.has(w.id))
    .map((w) => {
      const created = new Date(w.createdAt);
      const amountNum = Number(w.amount);
      const statusLabel = w.status.charAt(0).toUpperCase() + w.status.slice(1);
      return {
        id: w.id,
        type: 'withdraw' as const,
        label: 'Withdrawal',
        date: created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        amountDisplay: '-$' + Math.abs(amountNum).toLocaleString(),
        netDisplay: '$' + balance.toLocaleString(),
        currency: w.currency,
        note: 'Status: ' + statusLabel,
        createdAt: created.getTime(),
      };
    });


  const returnTransactions = userDemoCycles
    .filter((c) => c.status === 'completed')
    .map((c) => {
      const created = new Date(c.completedAt || c.updatedAt);
      const profit = Number(c.currentAmount) - Number(c.startingAmount);
      const endingAmount = Number(c.currentAmount);
      return {
        id: 'return-' + c.id,
        type: 'return' as const,
        label: 'Return',
        date: created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        time: created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
        amountDisplay: (profit >= 0 ? '+' : '-') + '$' + Math.abs(profit).toLocaleString(),
        netDisplay: '$' + endingAmount.toLocaleString(),
        currency: 'USDT',
        note: 'DEMO cycle return',
        createdAt: created.getTime(),
      };
    });

  const allTransactions = transactions
    .concat(syntheticDeposits as any, withdrawalTransactions as any, returnTransactions as any)
    .sort((a: any, b: any) => Number(b.createdAt) - Number(a.createdAt));

  return res.status(200).json({
    balance,
    totalDeposited,
    totalWithdrawn,
    totalRealizedPnl,
    totalProfit,
    activeDemoCycles,
    completedDemoCycles,
    totalCompletedDemoProfit,
    transactions: allTransactions,
  });
}
