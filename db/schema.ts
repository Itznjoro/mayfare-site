import { pgTable, pgEnum, uuid, text, timestamp, integer, numeric, uniqueIndex, index } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    telegram: text('telegram'), // optional, matches the signup form
    role: userRoleEnum('role').notNull().default('user'),
    // Simple DB-backed lockout so we don't need a separate cache/Redis layer
    // just to blunt brute-force login attempts.
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
  })
);

export const sessions = pgTable('sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ============================================================
// Financial records
// Foreign keys to users use the default "restrict" delete behavior
// (NOT cascade) — a user with financial history should never be
// deletable in a way that silently destroys that history.
// ============================================================

export const depositStatusEnum = pgEnum('deposit_status', ['pending', 'approved', 'rejected']);

export const deposits = pgTable(
  'deposits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    currency: text('currency').notNull().default('USDT'),
    status: depositStatusEnum('status').notNull().default('pending'),
    // e.g. a blockchain tx hash or payment reference, so an admin can verify
    // the deposit actually happened before approving it.
    txReference: text('tx_reference'),
    adminNote: text('admin_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('deposits_user_idx').on(table.userId),
    statusIdx: index('deposits_status_idx').on(table.status),
  })
);

export const withdrawalStatusEnum = pgEnum('withdrawal_status', ['pending', 'approved', 'rejected', 'completed']);

export const withdrawals = pgTable(
  'withdrawals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    currency: text('currency').notNull().default('USDT'),
    status: withdrawalStatusEnum('status').notNull().default('pending'),
    // Wallet address / bank details reference the user withdraws to.
    destination: text('destination').notNull(),
    adminNote: text('admin_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('withdrawals_user_idx').on(table.userId),
    statusIdx: index('withdrawals_status_idx').on(table.status),
  })
);

// A running, auditable record of every real balance movement for a user:
// deposits credited, withdrawals debited, and realized P&L from closed
// trades. This is the source of truth for "how did this user's balance
// get to what it is" — every entry traces back to a real event.
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', ['deposit', 'withdrawal', 'realized_pnl']);

export const accountLedger = pgTable(
  'account_ledger',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    type: ledgerEntryTypeEnum('type').notNull(),
    // Positive for credits (deposit, profit), negative for debits
    // (withdrawal, loss).
    amount: numeric('amount', { precision: 20, scale: 8 }).notNull(),
    // Points back to the deposits/withdrawals/trading_valuations row that
    // caused this entry, so every number here is traceable to a real event.
    referenceTable: text('reference_table'), // 'deposits' | 'withdrawals' | 'trading_valuations'
    referenceId: uuid('reference_id'),
    // Denormalized running balance snapshot after this entry — avoids
    // re-summing the whole ledger on every dashboard load.
    balanceAfter: numeric('balance_after', { precision: 20, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('account_ledger_user_idx').on(table.userId),
    createdIdx: index('account_ledger_created_idx').on(table.createdAt),
  })
);

// ============================================================
// Real MT5 trading data (individual accounts model)
// You said you'll sync this yourself — these tables are the target
// shape for that sync to write into.
// ============================================================

export const cycleStatusEnum = pgEnum('cycle_status', ['active', 'completed']);

// A real trading session tied to one user's own MT5 account.
export const poolCycles = pgTable(
  'pool_cycles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    mt5AccountId: text('mt5_account_id').notNull(),
    status: cycleStatusEnum('status').notNull().default('active'),
    startingBalance: numeric('starting_balance', { precision: 20, scale: 8 }).notNull(),
    endingBalance: numeric('ending_balance', { precision: 20, scale: 8 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('pool_cycles_user_idx').on(table.userId),
  })
);

export const tradeDirectionEnum = pgEnum('trade_direction', ['buy', 'sell']);
export const tradeStatusEnum = pgEnum('trade_status', ['open', 'closed_tp', 'closed_sl', 'closed_manual']);

// One real trade, synced from MT5. This is what "pending return" (distance
// to take-profit) and "total profit" (realized P&L once closed) are
// computed from — every field here should trace to a real MT5 order.
export const tradingValuations = pgTable(
  'trading_valuations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id),
    poolCycleId: uuid('pool_cycle_id').references(() => poolCycles.id),
    mt5TicketId: text('mt5_ticket_id').notNull(), // real MT5 order/position ticket
    symbol: text('symbol').notNull(), // e.g. 'EURUSD', 'BTCUSD'
    direction: tradeDirectionEnum('direction').notNull(),
    lotSize: numeric('lot_size', { precision: 12, scale: 4 }).notNull(),
    entryPrice: numeric('entry_price', { precision: 20, scale: 8 }).notNull(),
    takeProfit: numeric('take_profit', { precision: 20, scale: 8 }),
    stopLoss: numeric('stop_loss', { precision: 20, scale: 8 }),
    // Last known live price — updated by your sync while the trade is open.
    // Pending return = distance from this to takeProfit, in $ terms.
    currentPrice: numeric('current_price', { precision: 20, scale: 8 }),
    unrealizedPnl: numeric('unrealized_pnl', { precision: 20, scale: 8 }),
    realizedPnl: numeric('realized_pnl', { precision: 20, scale: 8 }),
    status: tradeStatusEnum('status').notNull().default('open'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('trading_valuations_user_idx').on(table.userId),
    cycleIdx: index('trading_valuations_cycle_idx').on(table.poolCycleId),
    statusIdx: index('trading_valuations_status_idx').on(table.status),
    // Prevents the same MT5 trade from ever being imported twice if your
    // sync process re-runs or overlaps.
    ticketIdx: uniqueIndex('trading_valuations_ticket_idx').on(table.userId, table.mt5TicketId),
  })
);

