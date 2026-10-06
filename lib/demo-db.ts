import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * Ensures the DEMO-only tables exist in environments where the migration
 * history says they were applied but the physical tables are missing.
 * This never touches real account balances or trading tables.
 */
export async function ensureDemoTables() {
  // Keep the DEMO status enum compatible with Stop Loss. This is deliberately
  // idempotent: it only creates the DEMO enum/table objects if they are missing
  // and never changes real account balances, deposits, withdrawals, or ledger data.
  await db.execute(sql`
    DO $$
    BEGIN
      CREATE TYPE "public"."demo_cycle_status"
      AS ENUM ('active', 'completed', 'stopped');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$;
  `);

  // If the enum already existed from the original DEMO migration, add the
  // Stop Loss value without replacing or recreating the enum. Keeping this as
  // a separate statement also avoids relying on transaction-specific enum
  // behaviour on different PostgreSQL versions.
  await db.execute(sql`
    ALTER TYPE "public"."demo_cycle_status"
    ADD VALUE IF NOT EXISTS 'stopped';
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "demo_cycles" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL REFERENCES "users"("id"),
      "source_deposit_id" uuid REFERENCES "deposits"("id"),
      "starting_amount" numeric(20,8) NOT NULL,
      "target_amount" numeric(20,8) NOT NULL,
      "current_amount" numeric(20,8) NOT NULL,
      "status" "demo_cycle_status" DEFAULT 'active' NOT NULL,
      "started_at" timestamp with time zone DEFAULT now() NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "completed_at" timestamp with time zone,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "demo_cycle_points" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "demo_cycle_id" uuid NOT NULL REFERENCES "demo_cycles"("id") ON DELETE CASCADE,
      "value" numeric(20,8) NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "demo_cycles_user_idx" ON "demo_cycles" ("user_id");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "demo_cycles_status_idx" ON "demo_cycles" ("status");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "demo_cycle_points_cycle_idx" ON "demo_cycle_points" ("demo_cycle_id");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "demo_cycle_points_created_idx" ON "demo_cycle_points" ("created_at");`);
}
