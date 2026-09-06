import { desc, eq } from 'drizzle-orm';
import { db } from './db';
import { accountLedger } from '../db/schema';

/**
 * Returns the user's current balance — the balanceAfter of their most
 * recent ledger entry, or 0 if they have none yet. This is the single
 * source of truth for "how much does this user have," used both when
 * crediting a new ledger entry (need the previous balance to add to) and
 * when displaying the dashboard.
 */
export async function getCurrentBalance(userId: string): Promise<number> {
  const [latest] = await db
    .select({ balanceAfter: accountLedger.balanceAfter })
    .from(accountLedger)
    .where(eq(accountLedger.userId, userId))
    .orderBy(desc(accountLedger.createdAt))
    .limit(1);

  return latest ? parseFloat(latest.balanceAfter) : 0;
}

/**
 * Appends a new ledger entry for a user, automatically computing the new
 * running balance from their current one. This is the ONLY function that
 * should ever insert into account_ledger — keeping balance math in one
 * place avoids two code paths disagreeing about how a balance changed.
 */
export async function addLedgerEntry(params: {
  userId: string;
  type: 'deposit' | 'withdrawal' | 'realized_pnl';
  amount: number; // positive for credits, negative for debits
  referenceTable?: string;
  referenceId?: string;
}) {
  const currentBalance = await getCurrentBalance(params.userId);
  const newBalance = currentBalance + params.amount;

  const [entry] = await db
    .insert(accountLedger)
    .values({
      userId: params.userId,
      type: params.type,
      amount: params.amount.toString(),
      referenceTable: params.referenceTable,
      referenceId: params.referenceId,
      balanceAfter: newBalance.toString(),
    })
    .returning();

  return entry;
}
