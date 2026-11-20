/**
 * Guest accounts — email + password on top of a guest profile.
 *
 * An account owns exactly one guest_profiles row. Signing up from a device
 * that already has a profile adopts that profile, so the guest keeps their
 * allergens, preferences and order history.
 *
 * Clients send the session token as: Authorization: Bearer <token>
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getSupabaseClient } from '../db/supabaseClient';
import { hashPassword, verifyPassword } from '../auth/password';
import { createSessionToken, verifySessionToken } from '../auth/token';
import { rateLimit } from '../middleware/rateLimit';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;

const signupLimit = rateLimit(5, 10 * 60 * 1000);
// Per email, not per IP: it stops password guessing on one account and isn't
// shared by every guest behind the client's server.
const loginLimit = rateLimit(10, 15 * 60 * 1000, (req) =>
    `login:${typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''}`);

async function getProfile(profileId: string | null) {
    if (!profileId) return null;
    const { data } = await getSupabaseClient()
        .from('guest_profiles')
        .select('*')
        .eq('id', profileId)
        .maybeSingle();
    return data;
}

function sessionResponse(account: { id: string; email: string }, profile: unknown) {
    return {
        token: createSessionToken(account.id),
        account: { id: account.id, email: account.email },
        profile,
    };
}

// ── POST /auth/signup ─────────────────────────────────────────────────────────
// Body: { email, password, firstName?, lastName?, deviceId? }
router.post('/signup', signupLimit, async (req: any, res: any) => {
    const { password, firstName, lastName, deviceId } = req.body ?? {};
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

    if (!email || !password) return res.status(400).json({ error: 'Укажите email и пароль' });
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Введите корректный email адрес' });
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
        return res.status(400).json({ error: `Пароль должен содержать минимум ${MIN_PASSWORD} символов` });
    }
    if (password.length > MAX_PASSWORD) return res.status(400).json({ error: 'Пароль слишком длинный' });

    const supabase = getSupabaseClient();

    const { data: existing } = await supabase.from('accounts').select('id').eq('email', email).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Аккаунт с таким email уже существует' });

    // Adopt the device's guest profile unless another account already owns it.
    let profile: any = null;
    if (typeof deviceId === 'string' && deviceId) {
        const { data } = await supabase.from('guest_profiles').select('*').eq('device_id', deviceId).maybeSingle();
        if (data) {
            const { data: owner } = await supabase.from('accounts').select('id').eq('guest_profile_id', data.id).maybeSingle();
            if (!owner) profile = data;
        }
    }
    if (!profile) {
        const { data, error } = await supabase
            .from('guest_profiles')
            .insert({ device_id: typeof deviceId === 'string' && deviceId ? `${deviceId}:${randomUUID()}` : `account:${randomUUID()}` })
            .select()
            .single();
        if (error) return res.status(500).json({ error: 'Не удалось создать профиль' });
        profile = data;
    }

    const nameUpdates: Record<string, string> = {};
    if (typeof firstName === 'string' && firstName.trim()) nameUpdates.name = firstName.trim().slice(0, 100);
    if (typeof lastName === 'string' && lastName.trim()) nameUpdates.surname = lastName.trim().slice(0, 100);
    if (Object.keys(nameUpdates).length) {
        const { data } = await supabase.from('guest_profiles').update(nameUpdates).eq('id', profile.id).select().single();
        if (data) profile = data;
    }

    const { data: account, error: insertError } = await supabase
        .from('accounts')
        .insert({ email, password_hash: await hashPassword(password), guest_profile_id: profile.id })
        .select('id, email')
        .single();

    if (insertError) {
        // Unique violation: a concurrent signup with the same email won the race.
        if (insertError.code === '23505') return res.status(409).json({ error: 'Аккаунт с таким email уже существует' });
        console.error('Signup insert error:', insertError.message);
        return res.status(500).json({ error: 'Произошла ошибка при создании аккаунта' });
    }

    res.status(201).json(sessionResponse(account, profile));
});

// ── POST /auth/login ──────────────────────────────────────────────────────────
// Body: { email, password }
router.post('/login', loginLimit, async (req: any, res: any) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = req.body?.password;
    if (!email || typeof password !== 'string' || !password) {
        return res.status(400).json({ error: 'Укажите email и пароль' });
    }

    const { data: account } = await getSupabaseClient()
        .from('accounts')
        .select('id, email, password_hash, guest_profile_id')
        .eq('email', email)
        .maybeSingle();

    // Same message for unknown email and wrong password.
    if (!account || !(await verifyPassword(password, account.password_hash))) {
        return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    res.json(sessionResponse(account, await getProfile(account.guest_profile_id)));
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────
router.get('/me', async (req: any, res: any) => {
    const header = req.headers.authorization ?? '';
    const session = header.startsWith('Bearer ') ? verifySessionToken(header.slice(7)) : null;
    if (!session) return res.status(401).json({ error: 'Unauthorized' });

    const { data: account } = await getSupabaseClient()
        .from('accounts')
        .select('id, email, guest_profile_id')
        .eq('id', session.sub)
        .maybeSingle();
    if (!account) return res.status(401).json({ error: 'Unauthorized' });

    res.json({ account: { id: account.id, email: account.email }, profile: await getProfile(account.guest_profile_id) });
});

export default router;
