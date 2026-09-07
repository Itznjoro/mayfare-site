import type { VercelRequest, VercelResponse } from '@vercel/node';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { users, withdrawals } from '../../db/schema';
import { requireAdmin } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const statusFilter = typeof req.query.status === 'string' ? req.query.status : null;
  const rows = await db
    .select({
      id: withdrawals.id,
      amount: withdrawals.amount,
      currency: withdrawals.currency,
      status: withdrawals.status,
      destination: withdrawals.destination,
      adminNote: withdrawals.adminNote,
      createdAt: withdrawals.createdAt,
      reviewedAt: withdrawals.reviewedAt,
      userId: users.id,
      userEmail: users.email,
      userFullName: users.fullName,
    })
    .from(withdrawals)
    .innerJoin(users, eq(withdrawals.userId, users.id))
    .where(statusFilter ? eq(withdrawals.status, statusFilter as any) : undefined)
    .orderBy(desc(withdrawals.createdAt));

  return res.status(200).json({ withdrawals: rows });
}
