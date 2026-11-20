import { createHmac, timingSafeEqual } from 'crypto';

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
    sub: string;  // account id
    exp: number;  // unix seconds
}

function secret(): string {
    const s = process.env.AUTH_SECRET;
    if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (32+ chars)');
    return s;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const sign = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url');

// A compact HMAC-signed token: base64url(payload).signature
export function createSessionToken(accountId: string): string {
    const payload: SessionPayload = { sub: accountId, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS };
    const body = b64(JSON.stringify(payload));
    return `${body}.${sign(body)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(sign(body));
    const actual = Buffer.from(sig);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
        if (!payload.sub || payload.exp < Date.now() / 1000) return null;
        return payload;
    } catch {
        return null;
    }
}
