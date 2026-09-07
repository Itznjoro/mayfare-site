import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * Keeps the withdrawal tables available in environments where the migration
 * journal says the financial migration ran but the physical withdrawal table
 * was never created. Safe to call from serverless handlers.
 */
export async function ensureWithdrawalTables() {
  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_status') THEN
        CREATE TYPE "withdrawal_status" AS ENUM ('pending', 'approved', 'rejected', 'completed');
      END IF;
    END
    $$;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "withdrawals" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL REFERENCES "users"("id"),
      "amount" numeric(20,8) NOT NULL,
      "currency" text DEFAULT 'USDT' NOT NULL,
      "status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
      "destination" text NOT NULL,
      "admin_note" text,
      "reviewed_by" uuid REFERENCES "users"("id"),
      "reviewed_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "withdrawals_user_idx" ON "withdrawals" ("user_id");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "withdrawals_status_idx" ON "withdrawals" ("status");`);
}
