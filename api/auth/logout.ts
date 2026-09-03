import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSessionIdFromRequest, deleteSession, clearSessionCookie } from '../../lib/auth';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = getSessionIdFromRequest(req);
  if (sessionId) {
    await deleteSession(sessionId);
  }
  clearSessionCookie(res);

  return res.status(200).json({ ok: true });
}
