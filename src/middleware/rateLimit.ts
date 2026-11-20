import type { Request, Response, NextFunction } from 'express';

// Small in-memory fixed-window limiter, per IP. Good enough for a single
// instance; move to a shared store if the backend is ever scaled out.
export function rateLimit(max: number, windowMs: number) {
    const hits = new Map<string, { count: number; reset: number }>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const now = Date.now();
        const key = req.ip ?? 'unknown';
        let entry = hits.get(key);
        if (!entry || entry.reset <= now) {
            entry = { count: 0, reset: now + windowMs };
            hits.set(key, entry);
        }
        entry.count++;
        if (hits.size > 10_000) {
            for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
        }
        if (entry.count > max) {
            res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
            res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
            return;
        }
        next();
    };
}
