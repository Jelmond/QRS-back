import { createHash, createHmac, timingSafeEqual } from 'crypto';

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days
const RESET_TTL = 60 * 60;             // 1 hour

export interface SessionPayload {
    sub: string;  // account id
    exp: number;  // unix seconds
    pwh: string;  // fingerprint of the password hash the token was issued for
}

interface ResetPayload extends SessionPayload {
    typ: 'reset';
}

function secret(): string {
    const s = process.env.AUTH_SECRET;
    if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (32+ chars)');
    return s;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const sign = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url');
const now = () => Math.floor(Date.now() / 1000);

// A compact HMAC-signed token: base64url(payload).signature
function createToken(payload: object): string {
    const body = b64(JSON.stringify(payload));
    return `${body}.${sign(body)}`;
}

function readToken(token: string): any | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(sign(body));
    const actual = Buffer.from(sig);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (!payload.sub || typeof payload.exp !== 'number' || payload.exp < now()) return null;
        return payload;
    } catch {
        return null;
    }
}

// Both token kinds carry a fingerprint of the password hash they were issued
// for: changing the password ends every session and voids every reset link.
const fingerprint = (passwordHash: string) => createHash('sha256').update(passwordHash).digest('base64url').slice(0, 22);

export function createSessionToken(accountId: string, passwordHash: string): string {
    return createToken({ sub: accountId, exp: now() + SESSION_TTL, pwh: fingerprint(passwordHash) });
}

export function verifySessionToken(token: string): SessionPayload | null {
    const payload = readToken(token);
    // A reset token must never work as a session.
    return payload && !payload.typ && typeof payload.pwh === 'string' ? payload : null;
}

export function createResetToken(accountId: string, passwordHash: string): string {
    const payload: ResetPayload = { sub: accountId, exp: now() + RESET_TTL, typ: 'reset', pwh: fingerprint(passwordHash) };
    return createToken(payload);
}

export function readResetToken(token: string): ResetPayload | null {
    const payload = readToken(token);
    return payload && payload.typ === 'reset' && typeof payload.pwh === 'string' ? payload : null;
}

export function tokenMatchesPassword(payload: SessionPayload, passwordHash: string): boolean {
    const a = Buffer.from(payload.pwh);
    const b = Buffer.from(fingerprint(passwordHash));
    return a.length === b.length && timingSafeEqual(a, b);
}
