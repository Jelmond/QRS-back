import type { Request, Response, NextFunction } from 'express';

/**
 * Simple shared-secret middleware for all /admin/* routes.
 * Set ADMIN_SECRET in .env. Clients must send:
 *   Authorization: Bearer <ADMIN_SECRET>
 *
 * Replace with full JWT auth once the auth system is built.
 */
export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfiguration: ADMIN_SECRET not set' });
    return;
  }

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token || token !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
