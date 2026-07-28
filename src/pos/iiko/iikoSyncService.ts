/**
 * Syncs iiko external menu (v2) into the Supabase database.
 * Triggered from admin panel via POST /sync/iiko.
 *
 * Strategy:
 *  - iiko itemCategories → categories  (upsert by iiko_group_id)
 *  - iiko items          → menu_items  (upsert by iiko_product_id + iiko_size_id)
 *  - items in DB not in iiko anymore   → soft-deleted (is_deleted = true)
 */

import { getSupabaseClient } from '../../db/supabaseClient';
import { getIikoRestaurantConfig } from '../../booking/bookingDb';
import {
  fetchIikoExternalMenus,
  fetchIikoExternalMenuById,
  fetchIikoStopList,
} from './iikoCloudClient';

export interface IikoSyncResult {
  externalMenuId: string;
  externalMenuName: string;
  categoriesAdded: number;
  categoriesUpdated: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsDeleted: number;
}

export async function syncIikoMenuToDatabase(restaurantId: string): Promise<IikoSyncResult> {
  const config = await getIikoRestaurantConfig(restaurantId);
  if (!config) throw new Error(`No iiko config for restaurant ${restaurantId}`);

  // 1. Discover external menu
  const menus = await fetchIikoExternalMenus([config.organizationId], config.apiLogin);
  if (!menus.length) {
    throw new Error(
      'No external menus found. Create one in iikoWeb → Внешние заказы → Меню → Внешнее меню → Сгенерировать из номенклатуры.'
    );
  }
  const externalMenuId = menus[0].id;
  const externalMenuName = menus[0].name;

  // 2. Fetch full menu + stop list in parallel
  const [menu, stopList] = await Promise.all([
    fetchIikoExternalMenuById(externalMenuId, [config.organizationId], config.apiLogin),
    config.terminalGroupId
      ? fetchIikoStopList(config.organizationId, config.terminalGroupId as string, config.apiLogin)
      : Promise.resolve([]),
  ]);

  const stoppedIds = new Set(stopList.map((s) => s.productId));
  const supabase = getSupabaseClient();

  let categoriesAdded = 0;
  let categoriesUpdated = 0;
  let itemsAdded = 0;
  let itemsUpdated = 0;
  let itemsDeleted = 0;

  const groupToCategoryId = new Map<string, string>();
  const activeIikoKeys = new Set<string>(); // `itemId:sizeId`

  const { data: maxRow } = await supabase
    .from('menu_items')
    .select('index_number')
    .eq('restaurant_id', restaurantId)
    .order('index_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextIndex = (maxRow?.index_number ?? 0) + 1;

  // ── 1. Sync itemCategories → categories ──────────────────────────────────────

  for (const cat of menu.itemCategories) {
    const iikoGroupId = cat.iikoGroupId ?? cat.id;

    const { data: existing } = await supabase
      .from('categories')
      .select('id, name')
      .eq('restaurant_id', restaurantId)
      .eq('iiko_group_id', iikoGroupId)
      .maybeSingle();

    if (existing) {
      groupToCategoryId.set(iikoGroupId, existing.id);
      if (existing.name !== cat.name) {
        await supabase.from('categories').update({ name: cat.name }).eq('id', existing.id);
        categoriesUpdated++;
      }
    } else {
      const { data: inserted } = await supabase
        .from('categories')
        .insert({
          restaurant_id: restaurantId,
          name: cat.name,
          slug: iikoGroupId,
          iiko_group_id: iikoGroupId,
        })
        .select('id')
        .single();

      if (inserted) {
        groupToCategoryId.set(iikoGroupId, inserted.id);
        categoriesAdded++;
      }
    }
  }

  // ── 2. Sync items → menu_items ───────────────────────────────────────────────

  for (const cat of menu.itemCategories) {
    const iikoGroupId = cat.iikoGroupId ?? cat.id;
    const categoryId = groupToCategoryId.get(iikoGroupId);
    if (!categoryId) continue;

    for (const item of cat.items) {
      if (item.isHidden) continue;
      const itemType = item.type?.toUpperCase();
      if (itemType && !['DISH', 'GOODS', 'SERVICE'].includes(itemType)) continue;

      const sizes = item.itemSizes.filter((s) => !s.isHidden);
      if (!sizes.length) continue;

      const isAvailable = !stoppedIds.has(item.itemId);

      for (const size of sizes) {
        const priceEntry =
          size.prices.find((p) => p.organizationId === config.organizationId) ?? size.prices[0];
        if (!priceEntry || typeof priceEntry.price !== 'number') continue;

        // null sizeId = single-size item; use itemId as fallback key
        const sizeId = size.sizeId ?? item.itemId;
        const key = `${item.itemId}:${sizeId}`;
        activeIikoKeys.add(key);

        const itemName =
          sizes.length === 1
            ? item.name
            : `${item.name} (${size.sizeName || sizeId})`;

        const nutrition = size.nutritionPerHundredGrams ?? {};

        const { data: existing } = await supabase
          .from('menu_items')
          .select('id, price, name, is_available')
          .eq('restaurant_id', restaurantId)
          .eq('iiko_product_id', item.itemId)
          .eq('iiko_size_id', sizeId)
          .maybeSingle();

        if (existing) {
          const updates: Record<string, unknown> = { is_deleted: false };
          if (existing.price !== priceEntry.price) updates.price = priceEntry.price;
          if (existing.name !== itemName) updates.name = itemName;
          if (existing.is_available !== isAvailable) updates.is_available = isAvailable;
          if (nutrition.energy) updates.calories = nutrition.energy;
          if (nutrition.proteins) updates.protein = nutrition.proteins;
          if (nutrition.fats) updates.fat = nutrition.fats;
          if (nutrition.carbs) updates.carbohydrates = nutrition.carbs;
          if (size.portionWeightGrams) updates.grams = size.portionWeightGrams;

          await supabase.from('menu_items').update(updates).eq('id', existing.id);
          itemsUpdated++;
        } else {
          await supabase.from('menu_items').insert({
            restaurant_id: restaurantId,
            category_id: categoryId,
            name: itemName,
            description: item.description ?? '',
            price: priceEntry.price,
            image: size.buttonImageUrl ?? '',
            index_number: nextIndex++,
            is_available: isAvailable,
            is_deleted: false,
            iiko_product_id: item.itemId,
            iiko_size_id: sizeId,
            calories: nutrition.energy ?? 0,
            protein: nutrition.proteins ?? 0,
            fat: nutrition.fats ?? 0,
            carbohydrates: nutrition.carbs ?? 0,
            grams: size.portionWeightGrams ?? 0,
          });
          itemsAdded++;
        }
      }
    }
  }

  // ── 3. Soft-delete items no longer in the external menu ──────────────────────

  const { data: dbItems } = await supabase
    .from('menu_items')
    .select('id, iiko_product_id, iiko_size_id')
    .eq('restaurant_id', restaurantId)
    .eq('is_deleted', false)
    .not('iiko_product_id', 'is', null);

  for (const dbItem of dbItems ?? []) {
    const key = `${dbItem.iiko_product_id}:${dbItem.iiko_size_id}`;
    if (!activeIikoKeys.has(key)) {
      await supabase
        .from('menu_items')
        .update({ is_deleted: true, is_available: false })
        .eq('id', dbItem.id);
      itemsDeleted++;
    }
  }

  console.info(
    `[sync] Menu sync for restaurant ${restaurantId} (${externalMenuName}): ` +
    `cats +${categoriesAdded}/~${categoriesUpdated}, ` +
    `items +${itemsAdded}/~${itemsUpdated}/-${itemsDeleted}`
  );

  return { externalMenuId, externalMenuName, categoriesAdded, categoriesUpdated, itemsAdded, itemsUpdated, itemsDeleted };
}
