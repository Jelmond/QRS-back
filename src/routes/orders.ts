/**
 * Public order routes.
 * POST /orders  — create order, optionally sync to iiko
 * GET  /orders/:id — get order status
 */

import { Router } from 'express';
import { getSupabaseClient } from '../db/supabaseClient';
import { getIikoRestaurantConfig } from '../booking/bookingDb';
import { createIikoTableOrder } from '../pos/iiko/iikoOrderClient';

const router = Router();

// ── POST /orders ──────────────────────────────────────────────────────────────
// Body:
//   restaurantId  uuid       required
//   tableId       uuid       local restaurant_tables.id
//   deviceId      string     identifies the guest (used to look up guest_profile_id)
//   items         { menuItemId: uuid, quantity: number }[]
//   comment?      string
//   isTogo?       boolean
router.post('/', async (req: any, res: any) => {
    const { restaurantId, tableId, deviceId, items, comment, isTogo } = req.body;

    if (!restaurantId)           return res.status(400).json({ error: 'restaurantId is required' });
    if (!tableId)                return res.status(400).json({ error: 'tableId is required' });
    if (!deviceId)               return res.status(400).json({ error: 'deviceId is required' });
    if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: 'items must be a non-empty array' });
    }

    const supabase = getSupabaseClient();

    // ── 1. Resolve guest profile ──────────────────────────────────────────────
    const { data: profile } = await supabase
        .from('guest_profiles')
        .select('id')
        .eq('device_id', deviceId)
        .maybeSingle();

    if (!profile) return res.status(404).json({ error: 'Guest profile not found — call POST /guest-profile first' });

    // ── 2. Resolve table ──────────────────────────────────────────────────────
    const { data: table } = await supabase
        .from('restaurant_tables')
        .select('id, table_number, iiko_table_id')
        .eq('id', tableId)
        .eq('restaurant_id', restaurantId)
        .maybeSingle();

    if (!table) return res.status(404).json({ error: 'Table not found' });

    // ── 3. Fetch current prices from DB (never trust the client) ──────────────
    const menuItemIds = items.map((i: any) => i.menuItemId);

    const { data: menuItems, error: menuError } = await supabase
        .from('menu_items')
        .select('id, name, price, is_available, iiko_product_id, iiko_size_id')
        .in('id', menuItemIds)
        .eq('restaurant_id', restaurantId)
        .eq('is_deleted', false);

    if (menuError) return res.status(500).json({ error: menuError.message });

    const menuMap = new Map((menuItems ?? []).map((m: any) => [m.id, m]));

    // Validate all items exist and are available
    for (const item of items) {
        const menuItem = menuMap.get(item.menuItemId);
        if (!menuItem)           return res.status(400).json({ error: `Menu item ${item.menuItemId} not found` });
        if (!menuItem.is_available) return res.status(400).json({ error: `Menu item "${menuItem.name}" is not available` });
        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
            return res.status(400).json({ error: `Invalid quantity for item ${item.menuItemId}` });
        }
    }

    // ── 4. Calculate total ────────────────────────────────────────────────────
    const orderLines = items.map((item: any) => {
        const menuItem = menuMap.get(item.menuItemId)!;
        return {
            menuItemId:    item.menuItemId,
            quantity:      item.quantity,
            price:         Number(menuItem.price),
            name:          menuItem.name,
            iikoProductId: menuItem.iiko_product_id ?? null,
            iikoSizeId:    menuItem.iiko_size_id ?? null,
        };
    });

    const total = orderLines.reduce((sum: number, l: any) => sum + l.price * l.quantity, 0);

    // ── 5. Insert order ───────────────────────────────────────────────────────
    const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
            restaurant_id:    restaurantId,
            guest_profile_id: profile.id,
            table_number:     table.table_number,
            total,
            status:           'pending',
            is_togo:          isTogo ?? false,
            pos_sync_status:  'pending',
        })
        .select('id, incremented_id, total, status')
        .single();

    if (orderError) return res.status(500).json({ error: orderError.message });

    // ── 6. Insert order items ─────────────────────────────────────────────────
    const { error: itemsError } = await supabase
        .from('order_items')
        .insert(orderLines.map((l: any) => ({
            order_id:     order.id,
            menu_item_id: l.menuItemId,
            quantity:     l.quantity,
            price:        l.price,
        })));

    if (itemsError) {
        // Roll back the order if items failed
        await supabase.from('orders').delete().eq('id', order.id);
        return res.status(500).json({ error: itemsError.message });
    }

    // Insert comment if provided
    if (comment) {
        await supabase.from('order_comments').insert({ order_id: order.id, comment });
    }

    // ── 7. Push to iiko (best-effort, non-blocking for response) ─────────────
    let iikoOrderId: string | null = null;
    let iikoPushError: string | null = null;

    const iikoConfig = await getIikoRestaurantConfig(restaurantId).catch(() => null);

    if (iikoConfig && table.iiko_table_id) {
        try {
            const iikoOrder = await createIikoTableOrder(iikoConfig, {
                tableIds:    [table.iiko_table_id],
                guestsCount: 1,
                comment:     comment ?? '',
                items:       orderLines.map((l: any) => ({
                    productId: l.iikoProductId,
                    quantity:  l.quantity,
                    price:     l.price,
                })).filter((l: any) => l.productId),
            });
            iikoOrderId = iikoOrder.id;

            await supabase
                .from('orders')
                .update({ iiko_order_id: iikoOrderId, pos_sync_status: 'synced' })
                .eq('id', order.id);
        } catch (err: any) {
            iikoPushError = err.message;
            console.error(`[orders] iiko push failed for order ${order.id}:`, err.message);
            await supabase
                .from('orders')
                .update({ pos_sync_status: 'error' })
                .eq('id', order.id);
        }
    } else if (iikoConfig && !table.iiko_table_id) {
        // POS configured but table not mapped — log and continue
        console.warn(`[orders] Table ${tableId} has no iiko_table_id — skipping iiko push`);
        await supabase.from('orders').update({ pos_sync_status: 'error' }).eq('id', order.id);
        iikoPushError = 'Table not mapped to iiko';
    }

    res.status(201).json({
        orderId:      order.id,
        incrementedId: order.incremented_id,
        total:        order.total,
        status:       order.status,
        iikoOrderId,
        iikoPushError,
    });
});

// ── GET /orders/:id ───────────────────────────────────────────────────────────
router.get('/:id', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('orders')
        .select(`
            id, incremented_id, table_number, status, total, tip_amount,
            is_togo, waiting_time, iiko_order_id, pos_sync_status, created_at,
            order_items (
                id, quantity, price,
                menu_items ( id, name, image )
            ),
            order_comments ( comment )
        `)
        .eq('id', req.params.id)
        .single();

    if (error || !data) return res.status(404).json({ error: 'Order not found' });
    res.json(data);
});

export default router;
