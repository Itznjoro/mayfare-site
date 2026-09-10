import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../../lib/db';
import { deposits } from '../../db/schema';
import { requireAuth } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return; // requireAuth already sent the 401

  const { amount, currency, txReference } = req.body ?? {};

  const parsedAmount = parseFloat(amount);
  if (!parsedAmount || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Enter a valid deposit amount.' });
  }
  if (parsedAmount < 150) {
    return res.status(400).json({ error: 'Minimum deposit is $150.' });
  }
  if (typeof currency !== 'string' || !currency.trim()) {
    return res.status(400).json({ error: 'A currency/network is required.' });
  }

  const [deposit] = await db
    .insert(deposits)
    .values({
      userId: user.id,
      amount: parsedAmount.toString(),
      currency: currency.trim(),
      txReference: typeof txReference === 'string' && txReference.trim() ? txReference.trim() : null,
      status: 'pending',
    })
    .returning();

  return res.status(201).json({ deposit });
}
