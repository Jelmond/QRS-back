import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';

const sha = (v: string) => createHash('sha256').update(v).digest();

// The Next.js client calls the backend from its own server, so every guest
// shares the client's IP. The client forwards the guest's IP in
// X-QRS-Client-IP, proven by X-QRS-Proxy-Secret (= ADMIN_SECRET).
export function clientIp(req: Request): string {
    const forwarded = req.header('x-qrs-client-ip');
    const proof = req.header('x-qrs-proxy-secret');
    const secret = process.env.ADMIN_SECRET;
    if (forwarded && proof && secret && timingSafeEqual(sha(proof), sha(secret))) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip ?? 'unknown';
}

// Small in-memory fixed-window limiter, per key (client IP by default). Good enough for a single
// instance; move to a shared store if the backend is ever scaled out.
export function rateLimit(max: number, windowMs: number, keyOf: (req: Request) => string = clientIp) {
    const hits = new Map<string, { count: number; reset: number }>();

    return (req: Request, res: Response, next: NextFunction): void => {
        const now = Date.now();
        const key = keyOf(req);
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
