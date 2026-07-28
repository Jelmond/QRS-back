import type { IPosAdapter } from '../posAdapter';
import type { PosOrderLineInput, PosProduct, PosServiceContext } from '../types';
import { getProductsByRestaurant } from '../../utils/getProductsFromSupabase';
import { getOrderPrice } from '../../utils/getOrderPrice';

function toOrderItems(lines: PosOrderLineInput[]): Parameters<typeof getOrderPrice>[0] {
  return lines.map((l) => ({
    id: l.productId,
    addons: l.addons,
  }));
}

export const supabaseAdapter: IPosAdapter = {
  systemName: 'supabase',

  async getProducts(ctx: PosServiceContext): Promise<PosProduct[]> {
    const rows = await getProductsByRestaurant(ctx.restaurantId);
    return rows.map((r) => ({
      id: r.id,
      name: r.id,
      price: r.price,
      isAvailable: true,
    }));
  },

  async calculateOrderTotal(lines: PosOrderLineInput[], ctx: PosServiceContext): Promise<number> {
    return getOrderPrice(toOrderItems(lines), ctx.restaurantId);
  },
};
