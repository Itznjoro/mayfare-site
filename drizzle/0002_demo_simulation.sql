CREATE TYPE "public"."demo_cycle_status" AS ENUM('active', 'completed');
--> statement-breakpoint
CREATE TABLE "demo_cycles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "source_deposit_id" uuid,
  "starting_amount" numeric(20,8) NOT NULL,
  "target_amount" numeric(20,8) NOT NULL,
  "current_amount" numeric(20,8) NOT NULL,
  "status" "demo_cycle_status" DEFAULT 'active' NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_cycle_points" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "demo_cycle_id" uuid NOT NULL,
  "value" numeric(20,8) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "demo_cycles" ADD CONSTRAINT "demo_cycles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "demo_cycles" ADD CONSTRAINT "demo_cycles_source_deposit_id_deposits_id_fk" FOREIGN KEY ("source_deposit_id") REFERENCES "deposits"("id");
--> statement-breakpoint
ALTER TABLE "demo_cycle_points" ADD CONSTRAINT "demo_cycle_points_demo_cycle_id_demo_cycles_id_fk" FOREIGN KEY ("demo_cycle_id") REFERENCES "demo_cycles"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "demo_cycles_user_idx" ON "demo_cycles" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "demo_cycles_status_idx" ON "demo_cycles" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "demo_cycle_points_cycle_idx" ON "demo_cycle_points" USING btree ("demo_cycle_id");
--> statement-breakpoint
CREATE INDEX "demo_cycle_points_created_idx" ON "demo_cycle_points" USING btree ("created_at");
