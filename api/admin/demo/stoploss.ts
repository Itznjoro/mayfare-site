import type { VercelRequest, VercelResponse } from '@vercel/node';
import { and, eq } from 'drizzle-orm';
import { db } from '../../../lib/db';
import { demoCycles, demoCyclePoints, deposits, withdrawals } from '../../../db/schema';
import { requireAdmin } from '../../../lib/auth';
import { ensureDemoTables } from '../../../lib/demo-db';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  try {
    await ensureDemoTables();
    const depositId = typeof req.body?.depositId === 'string' ? req.body.depositId : '';
    if (!depositId) return res.status(400).json({ error: 'Deposit ID is required.' });

    const [deposit] = await db.select({ id: deposits.id, userId: deposits.userId, status: deposits.status })
      .from(deposits).where(eq(deposits.id, depositId)).limit(1);
    if (!deposit) return res.status(404).json({ error: 'Deposit not found.' });
    if (deposit.status !== 'approved') return res.status(400).json({ error: 'Only an approved deposit can have a DEMO simulation stopped.' });

    const [cycle] = await db.select({ id: demoCycles.id })
      .from(demoCycles)
      .where(and(eq(demoCycles.userId, deposit.userId), eq(demoCycles.sourceDepositId, deposit.id), eq(demoCycles.status, 'active')))
      .limit(1);
    if (!cycle) return res.status(404).json({ error: 'No active DEMO simulation was found for this deposit.' });

    await db.transaction(async (tx) => {
      await tx.delete(demoCyclePoints).where(eq(demoCyclePoints.demoCycleId, cycle.id));
      await tx.delete(withdrawals).where(eq(withdrawals.adminNote, `DEMO_SIMULATION:${cycle.id}`));
      await tx.delete(demoCycles).where(eq(demoCycles.id, cycle.id));
    });

    return res.status(200).json({ stopped: true, demoCycleId: cycle.id });
  } catch (error) {
    console.error('DEMO stop-loss failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Could not stop the DEMO simulation.' });
  }
}
