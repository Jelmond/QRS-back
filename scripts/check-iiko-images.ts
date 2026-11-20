import dotenv from 'dotenv';
dotenv.config();

import { getIikoRestaurantConfig } from '../src/booking/bookingDb';
import { fetchIikoExternalMenus, fetchIikoExternalMenuById } from '../src/pos/iiko/iikoCloudClient';

// Replace with your actual restaurantId from Supabase
const RESTAURANT_ID = process.argv[2];

if (!RESTAURANT_ID) {
  console.error('Usage: npx ts-node scripts/check-iiko-images.ts <restaurantId>');
  process.exit(1);
}

(async () => {
  const config = await getIikoRestaurantConfig(RESTAURANT_ID);
  if (!config) { console.error('No iiko config found'); process.exit(1); }

  const menus = await fetchIikoExternalMenus([config.organizationId], config.apiLogin);
  const menu = await fetchIikoExternalMenuById(menus[0].id, [config.organizationId], config.apiLogin);

  // Find first item that has any image-related field
  for (const cat of menu.itemCategories) {
    for (const item of cat.items.slice(0, 3)) {
      console.log('\n── ITEM ─────────────────────────────────────────');
      console.log(JSON.stringify(item, null, 2));
      break;
    }
    break;
  }
})();
