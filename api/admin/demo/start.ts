import type { VercelRequest, VercelResponse } from '@vercel/node';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { deposits, demoCycles, demoCyclePoints } from '../../../db/schema';
import { requireAdmin } from '../../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const depositId = typeof req.body?.depositId === 'string' ? req.body.depositId : '';
  const target = Number(req.body?.targetAmount);
  if (!depositId || !Number.isFinite(target) || target <= 0) {
    return res.status(400).json({ error: 'Deposit ID and a positive demo target are required.' });
  }

  const [deposit] = await db.select().from(deposits).where(eq(deposits.id, depositId)).limit(1);
  if (!deposit) return res.status(404).json({ error: 'Deposit not found.' });
  if (deposit.status !== 'approved') return res.status(400).json({ error: 'Only approved deposits can start a DEMO simulation.' });
  if (target <= Number(deposit.amount)) return res.status(400).json({ error: 'Demo target must be greater than the deposited amount.' });

  const [existing] = await db.select({ id: demoCycles.id }).from(demoCycles)
    .where(and(eq(demoCycles.userId, deposit.userId), eq(demoCycles.status, 'active'))).limit(1);
  if (existing) return res.status(400).json({ error: 'This user already has an active DEMO simulation.' });

  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + 24 * 60 * 60 * 1000);
  const [cycle] = await db.insert(demoCycles).values({
    userId: deposit.userId,
    sourceDepositId: deposit.id,
    startingAmount: deposit.amount,
    targetAmount: target.toFixed(8),
    currentAmount: deposit.amount,
    status: 'active',
    startedAt,
    expiresAt,
    updatedAt: startedAt,
  }).returning();

  await db.insert(demoCyclePoints).values({ demoCycleId: cycle.id, value: deposit.amount });
  return res.status(200).json({ cycle });
}
