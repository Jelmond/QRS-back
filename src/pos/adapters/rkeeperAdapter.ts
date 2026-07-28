import type { IPosAdapter } from '../posAdapter';
import type { PosOrderLineInput, PosProduct, PosServiceContext } from '../types';

/**
 * R-Keeper integration via a JSON HTTP surface you control (proxy, Delivery API, etc.).
 *
 * Expected response shape for GET {RKEEPER_API_BASE_URL}{RKEEPER_PRODUCTS_PATH}:
 * `{ "items": [ { "id": "...", "name": "...", "price": 12.5, "isAvailable": true } ] }`
 *
 * Override path with `RKEEPER_PRODUCTS_PATH` (default `/products`). Query params:
 * `restaurantId`, optional `stationId` (from context.rkeeperStationId).
 */
function baseUrl(): string {
  const u = process.env.RKEEPER_API_BASE_URL || '';
  if (!u) {
    throw new Error(
      'R-Keeper: set RKEEPER_API_BASE_URL to your REST gateway (or UCS Delivery API base URL)'
    );
  }
  return u.replace(/\/$/, '');
}

function authHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  const token = process.env.RKEEPER_API_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const user = process.env.RKEEPER_API_BASIC_USER;
  const pass = process.env.RKEEPER_API_BASIC_PASSWORD;
  if (user && pass) {
    const b64 = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${b64}`;
  }
  return headers;
}

function parseProductsPayload(json: unknown): PosProduct[] {
  if (!json || typeof json !== 'object') return [];
  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];

  return items
    .map((row): PosProduct | null => {
      if (!row || typeof row !== 'object') return null;
      const o = row as Record<string, unknown>;
      const id = o.id;
      const name = o.name;
      const price = o.price;
      if (typeof id !== 'string' || typeof price !== 'number') return null;
      return {
        id,
        name: typeof name === 'string' ? name : id,
        price,
        isAvailable: typeof o.isAvailable === 'boolean' ? o.isAvailable : true,
      };
    })
    .filter((x): x is PosProduct => x !== null);
}

async function loadProducts(ctx: PosServiceContext): Promise<PosProduct[]> {
  const path = process.env.RKEEPER_PRODUCTS_PATH || '/products';
  const url = new URL(path.startsWith('http') ? path : `${baseUrl()}${path.startsWith('/') ? '' : '/'}${path}`);
  url.searchParams.set('restaurantId', ctx.restaurantId);
  const station = ctx.rkeeperStationId || (ctx.metadata?.rkeeperStationId as string | undefined);
  if (station) url.searchParams.set('stationId', station);

  const res = await fetch(url.toString(), { headers: authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`R-Keeper products error ${res.status}: ${JSON.stringify(body)}`);
  }
  return parseProductsPayload(body);
}

export const rkeeperAdapter: IPosAdapter = {
  systemName: 'rkeeper',

  async getProducts(ctx: PosServiceContext): Promise<PosProduct[]> {
    return loadProducts(ctx);
  },

  async calculateOrderTotal(lines: PosOrderLineInput[], ctx: PosServiceContext): Promise<number> {
    const products = await loadProducts(ctx);
    const byId = new Map(products.map((p) => [p.id, p]));

    let total = 0;
    for (const line of lines) {
      const p = byId.get(line.productId);
      if (!p) {
        throw new Error(`R-Keeper: unknown productId "${line.productId}"`);
      }
      const qty = line.quantity;
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`R-Keeper: invalid quantity for product "${line.productId}"`);
      }
      const addons = line.addons?.reduce((s, a) => s + a.price, 0) ?? 0;
      total += (p.price + addons) * qty;
    }
    return total;
  },
};
