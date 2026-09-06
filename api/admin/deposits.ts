import type { VercelRequest, VercelResponse } from '@vercel/node';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../lib/db';
import { deposits, users } from '../../db/schema';
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
      id: deposits.id,
      amount: deposits.amount,
      currency: deposits.currency,
      status: deposits.status,
      txReference: deposits.txReference,
      adminNote: deposits.adminNote,
      createdAt: deposits.createdAt,
      reviewedAt: deposits.reviewedAt,
      userId: users.id,
      userEmail: users.email,
      userFullName: users.fullName,
    })
    .from(deposits)
    .innerJoin(users, eq(deposits.userId, users.id))
    .where(statusFilter ? eq(deposits.status, statusFilter as any) : undefined)
    .orderBy(desc(deposits.createdAt));

  return res.status(200).json({ deposits: rows });
}
