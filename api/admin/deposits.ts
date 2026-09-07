import type { VercelRequest, VercelResponse } from '@vercel/node';
import { desc, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { deposits, users, accountLedger } from '../db/schema';
import { requireAdmin } from '../lib/auth';


export async function handleList(req: VercelRequest, res: VercelResponse) {
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


export async function handleApprove(req: VercelRequest, res: VercelResponse) {
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

  const [deposit] = await db.select().from(deposits).where(eq(deposits.id, id)).limit(1);
  if (!deposit) {
    return res.status(404).json({ error: 'Deposit not found.' });
  }
  if (deposit.status !== 'pending') {
    return res.status(400).json({ error: 'This deposit has already been reviewed.' });
  }

  // Approving a deposit and crediting the ledger must succeed together.
  // If either operation fails, the transaction rolls both back so an
  // approved deposit can never be left without a dashboard balance.
  try {
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(deposits)
        .set({
          status: 'approved',
          reviewedBy: admin.id,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(deposits.id, id))
        .returning();

      // Idempotency guard: never create a second ledger credit for the same deposit.
      const [existingCredit] = await tx
        .select({ id: accountLedger.id })
        .from(accountLedger)
        .where(eq(accountLedger.referenceId, deposit.id))
        .limit(1);

      if (!existingCredit) {
        // Rebuild the running balance from the ledger amounts instead of trusting
        // a possibly stale balanceAfter snapshot.
        const ledgerRows = await tx
          .select({ amount: accountLedger.amount })
          .from(accountLedger)
          .where(eq(accountLedger.userId, deposit.userId));
        const currentBalance = ledgerRows.reduce((sum, row) => sum + Number(row.amount), 0);
        const amount = Number(deposit.amount);
        const newBalance = currentBalance + amount;

        await tx.insert(accountLedger).values({
          userId: deposit.userId,
          type: 'deposit',
          amount: amount.toString(),
          referenceTable: 'deposits',
          referenceId: deposit.id,
          balanceAfter: newBalance.toString(),
        });
      }

      return updated;
    });

    return res.status(200).json({ deposit: result });
  } catch (error) {
    console.error('Deposit approval failed:', error);
    return res.status(500).json({ error: 'Could not approve the deposit and update the user balance.' });
  }
}


export async function handleReject(req: VercelRequest, res: VercelResponse) {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = String(req.query.route || '').replace(/^\/+|\/+$/g, '');
  if (!route) return handleList(req,res);
  const m = route.match(/^([^/]+)\/(approve|reject)$/);
  if (!m) return res.status(404).json({ error: 'Not found' });
  req.query.id = m[1];
  return m[2] === 'approve' ? handleApprove(req,res) : handleReject(req,res);
}
