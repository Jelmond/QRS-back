import { Router } from 'express';
import { getSupabaseClient } from '../db/supabaseClient';

const router = Router();

// ── Restaurants ───────────────────────────────────────────────────────────────

router.get('/', async (_req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('restaurants')
        .select('*')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.post('/', async (req: any, res: any) => {
    const {
        name, description, shortDescription, address, phone, image,
        workingHours, priceCategory, gmtOffset, serviceActive,
        telegramBotToken, telegramChatId,
        // Optional POS config — saves a second round-trip from the admin panel
        pos,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });

    const supabase = getSupabaseClient();

    const { data: restaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .insert({
            name,
            description:          description ?? null,
            short_description:    shortDescription ?? null,
            address:              address ?? null,
            phone:                phone ?? null,
            image:                image ?? null,
            working_hours:        workingHours ?? null,
            price_category:       priceCategory ?? null,
            gmt_offset:           gmtOffset ?? 0,
            service_active:       serviceActive ?? false,
            telegram_bot_token:   telegramBotToken ?? null,
            telegram_chat_id:     telegramChatId ?? null,
        })
        .select()
        .single();

    if (restaurantError) return res.status(500).json({ error: restaurantError.message });

    // If POS config was provided, create it immediately
    let posConfig = null;
    if (pos && typeof pos === 'object') {
        const { data: posData, error: posError } = await supabase
            .from('restaurant_pos')
            .insert({
                restaurant_id:          restaurant.id,
                pos_type:               pos.posType ?? null,
                iiko_api_login:         pos.iikoApiLogin ?? null,
                iiko_organization_id:   pos.iikoOrganizationId ?? null,
                iiko_terminal_group_id: pos.iikoTerminalGroupId ?? null,
                rkeeper_api_url:        pos.rkeeperApiUrl ?? null,
                rkeeper_station_id:     pos.rkeeperStationId ?? null,
            })
            .select()
            .single();

        if (posError) return res.status(500).json({
            error: `Restaurant created but POS config failed: ${posError.message}`,
            restaurant,
        });

        posConfig = posData;
    }

    res.status(201).json({ ...restaurant, pos: posConfig });
});

router.get('/:id', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('restaurants')
        .select('*')
        .eq('id', req.params.id)
        .eq('is_deleted', false)
        .single();

    if (error || !data) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(data);
});

router.patch('/:id', async (req: any, res: any) => {
    const allowed = [
        'name', 'description', 'short_description', 'address', 'phone', 'image',
        'working_hours', 'price_category', 'gmt_offset', 'service_active',
        'telegram_bot_token', 'telegram_chat_id',
    ];

    // Accept both camelCase and snake_case from the client
    const camelToSnake: Record<string, string> = {
        shortDescription: 'short_description',
        workingHours:     'working_hours',
        priceCategory:    'price_category',
        gmtOffset:        'gmt_offset',
        serviceActive:    'service_active',
        telegramBotToken: 'telegram_bot_token',
        telegramChatId:   'telegram_chat_id',
    };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(req.body)) {
        const col = camelToSnake[key] ?? key;
        if (allowed.includes(col)) updates[col] = value;
    }

    const { data, error } = await getSupabaseClient()
        .from('restaurants')
        .update(updates)
        .eq('id', req.params.id)
        .eq('is_deleted', false)
        .select()
        .single();

    if (error || !data) return res.status(404).json({ error: 'Restaurant not found' });
    res.json(data);
});

router.delete('/:id', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('restaurants')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select('id')
        .single();

    if (error || !data) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ message: 'Restaurant deleted' });
});

// ── Tables ────────────────────────────────────────────────────────────────────

router.get('/:id/tables', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('restaurant_tables')
        .select('*')
        .eq('restaurant_id', req.params.id)
        .order('table_number');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.post('/:id/tables', async (req: any, res: any) => {
    const { tableNumber, seats, status, type, socket, positionX, positionY, iikoTableId, iikoSectionId } = req.body;

    if (!tableNumber) return res.status(400).json({ error: 'tableNumber is required' });

    const { data, error } = await getSupabaseClient()
        .from('restaurant_tables')
        .insert({
            restaurant_id:   req.params.id,
            table_number:    tableNumber,
            seats:           seats ?? 4,
            status:          status ?? 'inactive',
            type:            type ?? 'default',
            socket:          socket ?? false,
            position_x:      positionX ?? null,
            position_y:      positionY ?? null,
            iiko_table_id:   iikoTableId ?? null,
            iiko_section_id: iikoSectionId ?? null,
        })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

router.patch('/:id/tables/:tableId', async (req: any, res: any) => {
    const camelToSnake: Record<string, string> = {
        tableNumber:    'table_number',
        positionX:      'position_x',
        positionY:      'position_y',
        iikoTableId:    'iiko_table_id',
        iikoSectionId:  'iiko_section_id',
    };

    const allowed = ['table_number', 'seats', 'status', 'type', 'socket',
                     'position_x', 'position_y', 'iiko_table_id', 'iiko_section_id'];

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [key, value] of Object.entries(req.body)) {
        const col = camelToSnake[key] ?? key;
        if (allowed.includes(col)) updates[col] = value;
    }

    const { data, error } = await getSupabaseClient()
        .from('restaurant_tables')
        .update(updates)
        .eq('id', req.params.tableId)
        .eq('restaurant_id', req.params.id)
        .select()
        .single();

    if (error || !data) return res.status(404).json({ error: 'Table not found' });
    res.json(data);
});

router.delete('/:id/tables/:tableId', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('restaurant_tables')
        .delete()
        .eq('id', req.params.tableId)
        .eq('restaurant_id', req.params.id)
        .select('id')
        .single();

    if (error || !data) return res.status(404).json({ error: 'Table not found' });
    res.json({ message: 'Table deleted' });
});

// ── Meal periods ──────────────────────────────────────────────────────────────

router.get('/:id/meal-periods', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('meal_periods')
        .select('*')
        .eq('restaurant_id', req.params.id)
        .order('start_time');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.post('/:id/meal-periods', async (req: any, res: any) => {
    const { name, startTime, endTime } = req.body;
    if (!name || !startTime || !endTime) {
        return res.status(400).json({ error: 'name, startTime and endTime are required' });
    }

    const { data, error } = await getSupabaseClient()
        .from('meal_periods')
        .insert({ restaurant_id: req.params.id, name, start_time: startTime, end_time: endTime })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

router.patch('/:id/meal-periods/:periodId', async (req: any, res: any) => {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (req.body.name)      updates.name       = req.body.name;
    if (req.body.startTime) updates.start_time = req.body.startTime;
    if (req.body.endTime)   updates.end_time   = req.body.endTime;

    const { data, error } = await getSupabaseClient()
        .from('meal_periods')
        .update(updates)
        .eq('id', req.params.periodId)
        .eq('restaurant_id', req.params.id)
        .select()
        .single();

    if (error || !data) return res.status(404).json({ error: 'Meal period not found' });
    res.json(data);
});

router.delete('/:id/meal-periods/:periodId', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('meal_periods')
        .delete()
        .eq('id', req.params.periodId)
        .eq('restaurant_id', req.params.id)
        .select('id')
        .single();

    if (error || !data) return res.status(404).json({ error: 'Meal period not found' });
    res.json({ message: 'Meal period deleted' });
});

// ── Categories ────────────────────────────────────────────────────────────────
// For non-iiko restaurants that manage categories manually.
// iiko restaurants get categories via POST /sync/iiko.

router.get('/:id/categories', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('categories')
        .select('*')
        .eq('restaurant_id', req.params.id)
        .order('name');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

router.post('/:id/categories', async (req: any, res: any) => {
    const { name, slug, isBeverage } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });

    const { data, error } = await getSupabaseClient()
        .from('categories')
        .insert({ restaurant_id: req.params.id, name, slug, is_beverage: isBeverage ?? false })
        .select()
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

router.patch('/:id/categories/:categoryId', async (req: any, res: any) => {
    const updates: Record<string, unknown> = {};
    if (req.body.name       !== undefined) updates.name        = req.body.name;
    if (req.body.slug       !== undefined) updates.slug        = req.body.slug;
    if (req.body.isBeverage !== undefined) updates.is_beverage = req.body.isBeverage;

    const { data, error } = await getSupabaseClient()
        .from('categories')
        .update(updates)
        .eq('id', req.params.categoryId)
        .eq('restaurant_id', req.params.id)
        .select()
        .single();

    if (error || !data) return res.status(404).json({ error: 'Category not found' });
    res.json(data);
});

router.delete('/:id/categories/:categoryId', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('categories')
        .delete()
        .eq('id', req.params.categoryId)
        .eq('restaurant_id', req.params.id)
        .select('id')
        .single();

    if (error || !data) return res.status(404).json({ error: 'Category not found' });
    res.json({ message: 'Category deleted' });
});

export default router;
