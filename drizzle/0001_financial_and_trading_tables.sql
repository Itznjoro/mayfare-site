CREATE TYPE "public"."cycle_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('deposit', 'withdrawal', 'realized_pnl');--> statement-breakpoint
CREATE TYPE "public"."trade_direction" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."trade_status" AS ENUM('open', 'closed_tp', 'closed_sl', 'closed_manual');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'approved', 'rejected', 'completed');--> statement-breakpoint
CREATE TABLE "account_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"reference_table" text,
	"reference_id" uuid,
	"balance_after" numeric(20, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"status" "deposit_status" DEFAULT 'pending' NOT NULL,
	"tx_reference" text,
	"admin_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mt5_account_id" text NOT NULL,
	"status" "cycle_status" DEFAULT 'active' NOT NULL,
	"starting_balance" numeric(20, 8) NOT NULL,
	"ending_balance" numeric(20, 8),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"pool_cycle_id" uuid,
	"mt5_ticket_id" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" "trade_direction" NOT NULL,
	"lot_size" numeric(12, 4) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"take_profit" numeric(20, 8),
	"stop_loss" numeric(20, 8),
	"current_price" numeric(20, 8),
	"unrealized_pnl" numeric(20, 8),
	"realized_pnl" numeric(20, 8),
	"status" "trade_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"destination" text NOT NULL,
	"admin_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_ledger" ADD CONSTRAINT "account_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_cycles" ADD CONSTRAINT "pool_cycles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_valuations" ADD CONSTRAINT "trading_valuations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_valuations" ADD CONSTRAINT "trading_valuations_pool_cycle_id_pool_cycles_id_fk" FOREIGN KEY ("pool_cycle_id") REFERENCES "public"."pool_cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_ledger_user_idx" ON "account_ledger" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "account_ledger_created_idx" ON "account_ledger" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deposits_user_idx" ON "deposits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deposits_status_idx" ON "deposits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pool_cycles_user_idx" ON "pool_cycles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trading_valuations_user_idx" ON "trading_valuations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "trading_valuations_cycle_idx" ON "trading_valuations" USING btree ("pool_cycle_id");--> statement-breakpoint
CREATE INDEX "trading_valuations_status_idx" ON "trading_valuations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_valuations_ticket_idx" ON "trading_valuations" USING btree ("user_id","mt5_ticket_id");--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawals" USING btree ("status");