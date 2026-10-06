import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { deposits } from '../../../../db/schema';
import { requireAdmin } from '../../../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const id = req.query.id;
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing deposit id.' });
  }

  const { adminNote } = req.body ?? {};

  const [deposit] = await db.select().from(deposits).where(eq(deposits.id, id)).limit(1);
  if (!deposit) {
    return res.status(404).json({ error: 'Deposit not found.' });
  }
  if (deposit.status !== 'pending') {
    return res.status(400).json({ error: 'This deposit has already been reviewed.' });
  }

  const [updated] = await db
    .update(deposits)
    .set({
      status: 'rejected',
      reviewedBy: admin.id,
      reviewedAt: new Date(),
      adminNote: typeof adminNote === 'string' && adminNote.trim() ? adminNote.trim() : null,
      updatedAt: new Date(),
    })
    .where(eq(deposits.id, id))
    .returning();

  return res.status(200).json({ deposit: updated });
}
