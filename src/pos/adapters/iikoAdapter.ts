import type { IPosAdapter } from '../posAdapter';
import type { PosOrderLineInput, PosProduct, PosServiceContext } from '../types';
import {
  fetchIikoNomenclature,
  fetchIikoStopList,
  mapIikoProductsToPosProducts,
} from '../iiko/iikoCloudClient';

function requireOrg(ctx: PosServiceContext): string {
  const id = ctx.iikoOrganizationId || (ctx.metadata?.iikoOrganizationId as string | undefined);
  if (!id) {
    throw new Error('iiko: set PosServiceContext.iikoOrganizationId');
  }
  return id;
}

async function loadProducts(ctx: PosServiceContext): Promise<PosProduct[]> {
  const orgId = requireOrg(ctx);
  const terminalGroupId =
    ctx.iikoTerminalGroupId || (ctx.metadata?.iikoTerminalGroupId as string | undefined);

  const [nomenclature, stopList] = await Promise.all([
    fetchIikoNomenclature(orgId),
    terminalGroupId
      ? fetchIikoStopList(orgId, terminalGroupId)
      : Promise.resolve([]),
  ]);

  return mapIikoProductsToPosProducts(nomenclature, stopList);
}

export const iikoAdapter: IPosAdapter = {
  systemName: 'iiko',

  async getProducts(ctx: PosServiceContext): Promise<PosProduct[]> {
    return loadProducts(ctx);
  },

  async calculateOrderTotal(lines: PosOrderLineInput[], ctx: PosServiceContext): Promise<number> {
    const products = await loadProducts(ctx);
    const byId = new Map(products.map((p) => [p.id, p]));

    let total = 0;
    for (const line of lines) {
      const p = byId.get(line.productId);
      if (!p) throw new Error(`iiko: unknown productId "${line.productId}"`);
      const qty = line.quantity;
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error(`iiko: invalid quantity for product "${line.productId}"`);
      }
      const addons = line.addons?.reduce((s, a) => s + a.price, 0) ?? 0;
      total += (p.price + addons) * qty;
    }
    return total;
  },
};
