/**
 * Public read (and limited write) routes — no auth required.
 * Used directly by the QRS client frontend.
 */

import { Router } from 'express';
import { getSupabaseClient } from '../db/supabaseClient';

const router = Router();

// ── GET /menu/:restaurantId ───────────────────────────────────────────────────
// Returns categories and menu items (with allergens & dietary prefs) for a restaurant.
router.get('/menu/:restaurantId', async (req: any, res: any) => {
    const { restaurantId } = req.params;
    const supabase = getSupabaseClient();

    const [categoriesResult, itemsResult] = await Promise.all([
        supabase
            .from('categories')
            .select('id, name, slug, is_beverage, iiko_group_id')
            .eq('restaurant_id', restaurantId)
            .order('name'),
        supabase
            .from('menu_items')
            .select(`
                id, name, description, price, image, index_number,
                is_available, is_popular, is_spicy, category_id,
                calories, protein, fat, carbohydrates, grams,
                iiko_product_id, iiko_size_id,
                menu_items_allergens ( allergen_id, allergens ( id, name, icon ) ),
                menu_items_dietary_preferences ( preference_id, dietary_preferences ( id, name, icon ) )
            `)
            .eq('restaurant_id', restaurantId)
            .eq('is_deleted', false)
            .order('index_number'),
    ]);

    if (categoriesResult.error) return res.status(500).json({ error: categoriesResult.error.message });
    if (itemsResult.error)      return res.status(500).json({ error: itemsResult.error.message });

    const items = (itemsResult.data ?? []).map((item: any) => ({
        ...item,
        allergens: (item.menu_items_allergens ?? []).map((a: any) => a.allergens).filter(Boolean),
        dietary_preferences: (item.menu_items_dietary_preferences ?? []).map((d: any) => d.dietary_preferences).filter(Boolean),
        menu_items_allergens: undefined,
        menu_items_dietary_preferences: undefined,
    }));

    res.json({ categories: categoriesResult.data ?? [], items });
});

// ── GET /allergens ────────────────────────────────────────────────────────────
router.get('/allergens', async (_req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('allergens')
        .select('id, name, icon, description')
        .order('name');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ── GET /dietary-preferences ──────────────────────────────────────────────────
router.get('/dietary-preferences', async (_req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('dietary_preferences')
        .select('id, name, icon, description')
        .order('name');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// ── GET /restaurants/:restaurantId/availability ───────────────────────────────
router.get('/restaurants/:restaurantId/availability', async (req: any, res: any) => {
    const { data, error } = await getSupabaseClient()
        .from('restaurants')
        .select('service_active')
        .eq('id', req.params.restaurantId)
        .eq('is_deleted', false)
        .single();

    if (error || !data) return res.status(404).json({ error: 'Restaurant not found' });
    res.json({ available: data.service_active });
});

// ── GET /restaurants/:restaurantId/reviews ────────────────────────────────────
// Query params: sort (newest|highest|lowest|helpful), page, limit, profileId
router.get('/restaurants/:restaurantId/reviews', async (req: any, res: any) => {
    const { restaurantId } = req.params;
    const sort      = (req.query.sort as string) ?? 'newest';
    const page      = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit     = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const profileId = req.query.profileId as string | undefined;

    const from = (page - 1) * limit;
    const to   = from + limit - 1;

    let query = getSupabaseClient()
        .from('restaurant_reviews')
        .select(`
            id, rating, comment, helpful_count, is_approved,
            reply_text, reply_author, reply_date, created_at,
            guest_profiles ( name, surname )
        `, { count: 'exact' })
        .eq('restaurant_id', restaurantId)
        .eq('is_approved', true);

    switch (sort) {
        case 'highest': query = query.order('rating', { ascending: false }); break;
        case 'lowest':  query = query.order('rating', { ascending: true });  break;
        case 'helpful': query = query.order('helpful_count', { ascending: false }); break;
        default:        query = query.order('created_at', { ascending: false });
    }

    query = query.range(from, to);

    const { data: reviews, count, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    // If caller sent their profileId, annotate which reviews they already voted on
    let votedIds = new Set<string>();
    if (profileId && reviews?.length) {
        const reviewIds = reviews.map((r: any) => r.id);
        const { data: votes } = await getSupabaseClient()
            .from('review_helpful_votes')
            .select('review_id')
            .eq('guest_profile_id', profileId)
            .in('review_id', reviewIds);
        votedIds = new Set((votes ?? []).map((v: any) => v.review_id));
    }

    const result = (reviews ?? []).map((r: any) => ({
        id:           r.id,
        rating:       r.rating,
        comment:      r.comment,
        helpful_count: r.helpful_count,
        reply_text:   r.reply_text,
        reply_author: r.reply_author,
        reply_date:   r.reply_date,
        created_at:   r.created_at,
        guest_name:   r.guest_profiles
            ? [r.guest_profiles.name, r.guest_profiles.surname].filter(Boolean).join(' ') || null
            : null,
        has_voted:    votedIds.has(r.id),
    }));

    res.json({ reviews: result, total: count ?? 0, page, limit });
});

// ── POST /restaurants/:restaurantId/reviews ───────────────────────────────────
// Body: { rating, comment, profileId }
router.post('/restaurants/:restaurantId/reviews', async (req: any, res: any) => {
    const { restaurantId } = req.params;
    const { rating, comment, profileId } = req.body;

    if (!rating || !comment || !profileId) {
        return res.status(400).json({ error: 'rating, comment and profileId are required' });
    }
    if (typeof rating !== 'number' || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'rating must be an integer between 1 and 5' });
    }

    const supabase = getSupabaseClient();

    // One review per guest per restaurant
    const { data: existing } = await supabase
        .from('restaurant_reviews')
        .select('id')
        .eq('restaurant_id', restaurantId)
        .eq('guest_profile_id', profileId)
        .maybeSingle();

    if (existing) {
        return res.status(409).json({ error: 'You have already reviewed this restaurant' });
    }

    const { data, error } = await supabase
        .from('restaurant_reviews')
        .insert({
            restaurant_id:    restaurantId,
            guest_profile_id: profileId,
            rating,
            comment,
        })
        .select('id, rating, comment, helpful_count, created_at')
        .single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json(data);
});

// ── POST /reviews/:reviewId/helpful ──────────────────────────────────────────
// Toggle helpful vote. Query param: profileId
router.post('/reviews/:reviewId/helpful', async (req: any, res: any) => {
    const { reviewId } = req.params;
    const profileId = (req.query.profileId ?? req.body.profileId) as string | undefined;

    if (!profileId) return res.status(400).json({ error: 'profileId is required' });

    const supabase = getSupabaseClient();

    const { data: existing } = await supabase
        .from('review_helpful_votes')
        .select('id')
        .eq('review_id', reviewId)
        .eq('guest_profile_id', profileId)
        .maybeSingle();

    let voted: boolean;

    if (existing) {
        await supabase
            .from('review_helpful_votes')
            .delete()
            .eq('review_id', reviewId)
            .eq('guest_profile_id', profileId);
        voted = false;
    } else {
        await supabase
            .from('review_helpful_votes')
            .insert({ review_id: reviewId, guest_profile_id: profileId });
        voted = true;
    }

    // Recount from votes table for accuracy rather than incrementing/decrementing
    const { count } = await supabase
        .from('review_helpful_votes')
        .select('*', { count: 'exact', head: true })
        .eq('review_id', reviewId);

    const helpfulCount = count ?? 0;

    await supabase
        .from('restaurant_reviews')
        .update({ helpful_count: helpfulCount })
        .eq('id', reviewId);

    res.json({ voted, helpful_count: helpfulCount });
});

export default router;
