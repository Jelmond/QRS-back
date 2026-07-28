/**
 * Guest profile routes — identified by deviceId (no user account required).
 */

import { Router } from 'express';
import { getSupabaseClient } from '../db/supabaseClient';

const router = Router();

// ── POST /guest-profile ───────────────────────────────────────────────────────
// Upsert a guest profile by deviceId. Returns the profile.
// Body: { deviceId }
router.post('/', async (req: any, res: any) => {
    const { deviceId } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

    const supabase = getSupabaseClient();

    const { data: existing } = await supabase
        .from('guest_profiles')
        .select('*')
        .eq('device_id', deviceId)
        .maybeSingle();

    if (existing) {
        // Update last_seen_at
        const { data, error } = await supabase
            .from('guest_profiles')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('device_id', deviceId)
            .select()
            .single();
        if (error) return res.status(500).json({ error: error.message });

        const allergens = await fetchAllergens(supabase, data.id);
        return res.json({ ...data, allergens });
    }

    const { data, error } = await supabase
        .from('guest_profiles')
        .insert({ device_id: deviceId })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ ...data, allergens: [] });
});

// ── PUT /guest-profile/personal-info ─────────────────────────────────────────
// Body: { deviceId, name?, birth_date?, phone_number? }
router.put('/personal-info', async (req: any, res: any) => {
    const { deviceId, name, birth_date, phone_number } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });

    const updates: Record<string, unknown> = {};
    if (name         !== undefined) updates.name         = name;
    if (birth_date   !== undefined) updates.birth_date   = birth_date;
    if (phone_number !== undefined) updates.phone_number = phone_number;

    if (!Object.keys(updates).length) {
        return res.status(400).json({ error: 'At least one field to update is required' });
    }

    const { data, error } = await getSupabaseClient()
        .from('guest_profiles')
        .update(updates)
        .eq('device_id', deviceId)
        .select()
        .single();

    if (error || !data) return res.status(404).json({ error: 'Profile not found' });
    res.json(data);
});

// ── PUT /guest-profile/allergens ─────────────────────────────────────────────
// Replaces the full allergen list for a guest.
// Body: { deviceId, allergens: string[] }  — allergens is array of allergen UUIDs
router.put('/allergens', async (req: any, res: any) => {
    const { deviceId, allergens } = req.body;
    if (!deviceId)          return res.status(400).json({ error: 'deviceId is required' });
    if (!Array.isArray(allergens)) return res.status(400).json({ error: 'allergens must be an array of UUIDs' });

    const supabase = getSupabaseClient();

    const { data: profile } = await supabase
        .from('guest_profiles')
        .select('id')
        .eq('device_id', deviceId)
        .single();

    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Full replace: delete all then insert new
    await supabase
        .from('guest_profile_allergens')
        .delete()
        .eq('guest_profile_id', profile.id);

    if (allergens.length) {
        const { error } = await supabase
            .from('guest_profile_allergens')
            .insert(allergens.map((id: string) => ({ guest_profile_id: profile.id, allergen_id: id })));
        if (error) return res.status(500).json({ error: error.message });
    }

    res.json({ allergens });
});

// ── PUT /guest-profile/preferences ───────────────────────────────────────────
// Body: { deviceId, preferences: Record<string, unknown> }
router.put('/preferences', async (req: any, res: any) => {
    const { deviceId, preferences } = req.body;
    if (!deviceId)               return res.status(400).json({ error: 'deviceId is required' });
    if (typeof preferences !== 'object' || preferences === null) {
        return res.status(400).json({ error: 'preferences must be an object' });
    }

    const { data, error } = await getSupabaseClient()
        .from('guest_profiles')
        .update({ preferences })
        .eq('device_id', deviceId)
        .select()
        .single();

    if (error || !data) return res.status(404).json({ error: 'Profile not found' });
    res.json(data);
});

async function fetchAllergens(supabase: ReturnType<typeof getSupabaseClient>, profileId: string) {
    const { data } = await supabase
        .from('guest_profile_allergens')
        .select('allergen_id, allergens ( id, name, icon )')
        .eq('guest_profile_id', profileId);
    return (data ?? []).map((row: any) => row.allergens).filter(Boolean);
}

export default router;
