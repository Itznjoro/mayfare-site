import type { VercelRequest, VercelResponse } from '@vercel/node';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../lib/db';
import { demoCycles, demoCyclePoints, withdrawals } from '../../db/schema';
import { requireAuth } from '../../lib/auth';

function clamp(n: number, min: number, max: number) { return Math.min(max, Math.max(min, n)); }

function nextDemoValue(current: number, start: number, target: number, progress: number) {
  const gap = target - current;
  const expected = (target - start) * progress;
  const noise = (Math.random() - 0.5) * Math.max((target - start) * 0.035, start * 0.0025);
  const pull = (start + expected - current) * 0.16;
  const jump = gap * 0.018 + noise + pull;
  return clamp(current + jump, start, target);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;


  let [cycle] = await db.select().from(demoCycles)
    .where(and(eq(demoCycles.userId, user.id), eq(demoCycles.status, 'active'))).limit(1);

  if (!cycle) return res.status(200).json({ active: false });

  const now = new Date();
  const startMs = cycle.startedAt.getTime();
  const expiresMs = cycle.expiresAt.getTime();
  const progress = clamp((now.getTime() - startMs) / (expiresMs - startMs), 0, 1);
  let current = Number(cycle.currentAmount);
  let status = cycle.status;

  // Throttle DB writes to roughly one point per second while the browser polls.
  const latestPoint = await db.select({ createdAt: demoCyclePoints.createdAt })
    .from(demoCyclePoints).where(eq(demoCyclePoints.demoCycleId, cycle.id))
    .orderBy(desc(demoCyclePoints.createdAt)).limit(1);
  const canStep = !latestPoint[0] || now.getTime() - latestPoint[0].createdAt.getTime() >= 900;

  if (progress >= 1) {
    current = Number(cycle.targetAmount);
    status = 'completed';
  } else if (canStep) {
    current = nextDemoValue(current, Number(cycle.startingAmount), Number(cycle.targetAmount), progress);
  }

  if (canStep || status === 'completed') {
    await db.update(demoCycles).set({
      currentAmount: current.toFixed(8),
      status,
      completedAt: status === 'completed' ? now : null,
      updatedAt: now,
    }).where(eq(demoCycles.id, cycle.id));
    await db.insert(demoCyclePoints).values({ demoCycleId: cycle.id, value: current.toFixed(8) });
    [cycle] = await db.select().from(demoCycles).where(eq(demoCycles.id, cycle.id)).limit(1);
  }

  // Keep the chart lightweight while preserving the full DEMO history. The raw
  // points are written roughly once per second, so aggregate them to one point
  // per minute in PostgreSQL. The client can then render 1m/5m/15m/1H/4H views
  // without downloading tens of thousands of rows on every dashboard poll.
  const minuteRows = (await db.execute(sql`
    SELECT
      date_trunc('minute', "created_at") AS bucket,
      (array_agg("value" ORDER BY "created_at" DESC))[1] AS value
    FROM "demo_cycle_points"
    WHERE "demo_cycle_id" = ${cycle.id}
    GROUP BY bucket
    ORDER BY bucket ASC
  `)).rows as Array<{ bucket: Date | string; value: string }>;

  const starting = Number(cycle.startingAmount);
  const target = Number(cycle.targetAmount);
  const currentAmount = Number(cycle.currentAmount);
  const profit = currentAmount - starting;
  const pending = Math.max(target - currentAmount, 0);

  // DEMO withdrawals are simulated separately from the real account ledger.
  // Pending DEMO requests reserve part of the current simulated balance.
  const demoWithdrawalRows = await db.select({ amount: withdrawals.amount, status: withdrawals.status, adminNote: withdrawals.adminNote })
    .from(withdrawals)
    .where(eq(withdrawals.userId, user.id));
  const demoMarker = `DEMO_SIMULATION:${cycle.id}`;
  const pendingDemoWithdrawals = demoWithdrawalRows
    .filter((row) => row.status === 'pending' && String(row.adminNote || '') === demoMarker)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const withdrawableAmount = Math.max(currentAmount - pendingDemoWithdrawals, 0);

  const chartPoints = minuteRows.map((p) => ({
    createdAt: new Date(p.bucket).toISOString(),
    value: Number(p.value),
  }));

  return res.status(200).json({
    active: true,
    cycleId: cycle.id,
    status: cycle.status,
    startingAmount: starting,
    targetAmount: target,
    currentAmount,
    profit,
    pendingReturn: pending,
    payout: profit,
    pendingDemoWithdrawals,
    withdrawableAmount,
    progressPercent: target > 0 ? (currentAmount / target) * 100 : 0,
    expiresAt: cycle.expiresAt,
    chartPoints,
  });
}
