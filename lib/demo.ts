import { sql } from 'drizzle-orm';
import { db } from './db';

export async function ensureDemoTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS demo_simulations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      starting_amount numeric(20,8) NOT NULL,
      target_profit numeric(20,8) NOT NULL,
      current_assets numeric(20,8) NOT NULL,
      status text NOT NULL DEFAULT 'active',
      started_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS demo_simulations_user_idx ON demo_simulations(user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS demo_simulations_status_idx ON demo_simulations(status)
  `);
}

function demoProgress(startedAt: Date, expiresAt: Date): number {
  const now = Date.now();
  const start = startedAt.getTime();
  const end = expiresAt.getTime();
  if (now <= start) return 0;
  if (now >= end) return 1;

  const progress = (now - start) / (end - start);
  const minute = Math.floor((now - start) / 60000);
  const wobble = Math.sin(minute * 1.73) * 0.035 + Math.sin(minute * 0.47) * 0.02;
  return Math.min(1, Math.max(0, progress + wobble * Math.min(1, progress * 4)));
}

export async function getActiveDemo(userId: string) {
  await ensureDemoTable();
  const result = await db.execute(sql`
    SELECT id, user_id, starting_amount, target_profit, current_assets, status,
           started_at, expires_at, completed_at, created_at, updated_at
    FROM demo_simulations
    WHERE user_id = ${userId} AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = result.rows[0] as any;
  if (!row) return null;

  const startedAt = new Date(row.started_at);
  const expiresAt = new Date(row.expires_at);
  const progress = demoProgress(startedAt, expiresAt);
  const starting = Number(row.starting_amount);
  const targetProfit = Number(row.target_profit);
  const targetAssets = starting + targetProfit;
  const currentAssets = starting + targetProfit * progress;
  const expired = Date.now() >= expiresAt.getTime();
  const finalAssets = expired ? targetAssets : currentAssets;
  const status = expired ? 'completed' : 'active';

  await db.execute(sql`
    UPDATE demo_simulations
    SET current_assets = ${finalAssets},
        status = ${status},
        completed_at = ${expired ? expiresAt : null},
        updated_at = now()
    WHERE id = ${row.id}
  `);

  return {
    id: row.id,
    startingAmount: starting,
    targetProfit,
    targetAssets,
    currentAssets: finalAssets,
    totalProfit: finalAssets - starting,
    pendingReturns: Math.max(0, targetAssets - finalAssets),
    status,
    startedAt: startedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    completedAt: expired ? expiresAt.toISOString() : null,
  };
}
