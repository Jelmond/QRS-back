export type PosSystemName = 'iiko' | 'rkeeper' | 'supabase';

/** Normalized product row from any POS (prices in major currency units, e.g. BYN/RUB). */
export interface PosProduct {
  id: string;
  name: string;
  price: number;
  isAvailable?: boolean;
  /** iiko: default size id when multiple sizes exist (composite `productId:sizeId` in `id`). */
  sizeId?: string;
}

/** Cart line for server-side total calculation. */
export interface PosOrderLineInput {
  productId: string;
  quantity: number;
  addons?: Array<{ id: string; price: number }>;
}

/**
 * Context passed to every POS call. Map your restaurant row to this once per request
 * (or store `iikoOrganizationId` / R-Keeper ids next to `restaurant_id` in Supabase).
 */
export interface PosServiceContext {
  restaurantId: string;
  /** iiko Cloud organization UUID. */
  iikoOrganizationId?: string;
  /** iiko terminal group UUID — required for stop list and order creation. */
  iikoTerminalGroupId?: string;
  /** R-Keeper: station / restaurant object code if your API requires it. */
  rkeeperStationId?: string;
  metadata?: Record<string, unknown>;
}
