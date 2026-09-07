import type { VercelRequest, VercelResponse } from '@vercel/node';
import { eq } from 'drizzle-orm';
import { db } from '../../../../lib/db';
import { withdrawals } from '../../../../db/schema';
import { requireAdmin } from '../../../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'Withdrawal id is required.' });

  const [existing] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
  if (!existing) return res.status(404).json({ error: 'Withdrawal not found.' });
  if (existing.status !== 'pending') return res.status(409).json({ error: `Withdrawal is already ${existing.status}.` });

  const note = typeof req.body?.adminNote === 'string' ? req.body.adminNote.trim() : null;
  const [updated] = await db.update(withdrawals).set({
    status: 'rejected',
    adminNote: note || existing.adminNote,
    reviewedBy: admin.id,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(withdrawals.id, id)).returning();

  return res.status(200).json({ withdrawal: updated });
}
