import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sql } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { requireAdmin } from '../../../lib/auth';
import { ensureDemoTable } from '../../../lib/demo';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { userId, startingAmount, targetProfit } = req.body || {};
  const amount = Number(startingAmount);
  const profit = Number(targetProfit);

  if (typeof userId !== 'string' || !userId) return res.status(400).json({ error: 'Missing userId.' });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Starting amount must be greater than zero.' });
  if (!Number.isFinite(profit) || profit <= 0) return res.status(400).json({ error: 'Target demo profit must be greater than zero.' });

  await ensureDemoTable();
  const user = await db.execute(sql`SELECT id FROM users WHERE id = ${userId} LIMIT 1`);
  if (!user.rows.length) return res.status(404).json({ error: 'User not found.' });

  await db.execute(sql`
    UPDATE demo_simulations
    SET status = 'completed', completed_at = now(), updated_at = now()
    WHERE user_id = ${userId} AND status = 'active'
  `);

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000);
  const created = await db.execute(sql`
    INSERT INTO demo_simulations
      (user_id, starting_amount, target_profit, current_assets, status, started_at, expires_at)
    VALUES
      (${userId}, ${amount}, ${profit}, ${amount}, 'active', ${startedAt}, ${expiresAt})
    RETURNING id, user_id, starting_amount, target_profit, current_assets, status, started_at, expires_at
  `);

  return res.status(201).json({
    demo: created.rows[0],
    message: 'DEMO simulation started. This is not real trading performance.'
  });
}
