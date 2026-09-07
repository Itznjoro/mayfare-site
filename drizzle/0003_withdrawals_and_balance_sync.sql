DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'withdrawal_status') THEN
    CREATE TYPE "withdrawal_status" AS ENUM ('pending', 'approved', 'rejected', 'completed');
  END IF;
END
$$;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_user_idx" ON "withdrawals" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "withdrawals_status_idx" ON "withdrawals" ("status");
--> statement-breakpoint
WITH missing AS (
  SELECT d.id, d.user_id, d.amount, d.created_at
  FROM "deposits" d
  WHERE d.status = 'approved'
    AND NOT EXISTS (
      SELECT 1
      FROM "account_ledger" l
      WHERE l.reference_table = 'deposits'
        AND l.reference_id = d.id
    )
), base AS (
  SELECT u.id AS user_id, COALESCE(SUM(l.amount), 0) AS starting_balance
  FROM "users" u
  LEFT JOIN "account_ledger" l ON l.user_id = u.id
  GROUP BY u.id
), ordered AS (
  SELECT
    m.*,
    b.starting_balance,
    SUM(m.amount) OVER (
      PARTITION BY m.user_id
      ORDER BY m.created_at, m.id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cumulative_missing
  FROM missing m
  JOIN base b ON b.user_id = m.user_id
)
INSERT INTO "account_ledger" (
  "user_id", "type", "amount", "reference_table", "reference_id", "balance_after"
)
SELECT
  user_id,
  'deposit'::"ledger_entry_type",
  amount,
  'deposits',
  id,
  starting_balance + cumulative_missing
FROM ordered;
