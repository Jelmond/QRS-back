/**
 * Admin POS management routes.
 * All routes require restaurantId — either as query param (GET) or request body (POST/PUT).
 *
 * Ported from haratsBooking/admin_app.py — iiko integration section.
 */

import { Router } from 'express';
import { getSupabaseClient } from '../db/supabaseClient';
import { getIikoRestaurantConfig } from '../booking/bookingDb';
import { isTerminalAlive, fetchIikoSections } from '../pos/iiko/iikoReserveClient';
import { syncReservationToPos } from '../booking/bookingService';
import { syncRestaurantReservations } from '../booking/iikoReservationSync';

const router = Router();

// ── GET /admin/pos/status ─────────────────────────────────────────────────────
// Returns: is POS configured, is terminal alive, count of failed syncs.
router.get('/status', async (req: any, res: any) => {
    const { restaurantId } = req.query;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId query param required' });

    const config = await getIikoRestaurantConfig(restaurantId as string).catch(() => null);
    if (!config) {
        return res.json({ configured: false, terminalAlive: false, failedSyncCount: 0 });
    }

    const [alive, { count }] = await Promise.all([
        isTerminalAlive(config).catch(() => false),
        getSupabaseClient()
            .from('restaurant_reservations')
            .select('*', { count: 'exact', head: true })
            .eq('restaurant_id', restaurantId)
            .eq('status', 'confirmed')
            .eq('iiko_creation_status', 'Error')
            .is('iiko_reserve_id', null),
    ]);

    res.json({ configured: true, terminalAlive: alive, failedSyncCount: count ?? 0 });
});

// ── POST /admin/pos/retry-failed ──────────────────────────────────────────────
// Retries sync for confirmed reservations that previously failed to push to iiko.
router.post('/retry-failed', async (req: any, res: any) => {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });

    const { data: rows, error } = await getSupabaseClient()
        .from('restaurant_reservations')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'confirmed')
        .is('iiko_reserve_id', null)
        .or('iiko_creation_status.eq.Error,iiko_creation_status.is.null')
        .gt('starts_at', new Date().toISOString());

    if (error) return res.status(500).json({ error: error.message });

    let retried = 0;
    for (const row of rows ?? []) {
        await syncReservationToPos(row.id, restaurantId);
        retried++;
    }

    res.json({ retried });
});

// ── POST /admin/pos/sync ──────────────────────────────────────────────────────
// Full bidirectional sync:
//   Local → iiko : push failed/unsynced confirmed reservations
//   iiko → local : pull new iiko reserves, reconcile cancellations both ways
router.post('/sync', async (req: any, res: any) => {
    const { restaurantId } = req.body;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });

    const result = await syncRestaurantReservations(restaurantId);
    if (!result.ok) return res.status(503).json(result);
    res.json(result);
});

// ── GET /admin/pos/config ─────────────────────────────────────────────────────
// Returns the current POS configuration for a restaurant.
router.get('/config', async (req: any, res: any) => {
    const { restaurantId } = req.query;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId query param required' });

    const { data, error } = await getSupabaseClient()
        .from('restaurant_pos')
        .select('id, pos_type, iiko_api_login, iiko_organization_id, iiko_terminal_group_id, rkeeper_api_url, rkeeper_station_id')
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.json({ configured: false });

    const { iiko_api_login, ...rest } = data;
    res.json({ configured: true, ...rest, iiko_api_login_set: !!iiko_api_login });
});

// ── PUT /admin/pos/config ─────────────────────────────────────────────────────
// Create or update POS configuration for a restaurant.
router.put('/config', async (req: any, res: any) => {
    const {
        restaurantId,
        posType,
        iikoApiLogin,
        iikoOrganizationId,
        iikoTerminalGroupId,
        rkeeperApiUrl,
        rkeeperStationId,
    } = req.body;

    if (!restaurantId) return res.status(400).json({ error: 'restaurantId is required' });

    const payload = {
        restaurant_id:           restaurantId,
        pos_type:                posType ?? null,
        iiko_api_login:          iikoApiLogin ?? null,
        iiko_organization_id:    iikoOrganizationId ?? null,
        iiko_terminal_group_id:  iikoTerminalGroupId ?? null,
        rkeeper_api_url:         rkeeperApiUrl ?? null,
        rkeeper_station_id:      rkeeperStationId ?? null,
    };

    const { data, error } = await getSupabaseClient()
        .from('restaurant_pos')
        .upsert(payload, { onConflict: 'restaurant_id' })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ── GET /admin/pos/sections ───────────────────────────────────────────────────
// Fetches iiko hall sections with their tables.
// Use this in the admin panel to map local restaurant_tables to iiko UUIDs.
router.get('/sections', async (req: any, res: any) => {
    const { restaurantId } = req.query;
    if (!restaurantId) return res.status(400).json({ error: 'restaurantId query param required' });

    const config = await getIikoRestaurantConfig(restaurantId as string).catch(() => null);
    if (!config) return res.status(404).json({ error: 'POS not configured for this restaurant' });

    try {
        const sections = await fetchIikoSections(config);
        res.json({ sections });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
