import { createPosAdapter } from './createPosAdapter';
import type { PosOrderLineInput, PosProduct, PosServiceContext } from './types';

/** Load products for the given POS integration. */
export async function getPosProducts(
  posSystemName: string,
  ctx: PosServiceContext
): Promise<PosProduct[]> {
  return createPosAdapter(posSystemName).getProducts(ctx);
}

/** Calculate cart total using that POS price list. */
export async function calculatePosOrderTotal(
  posSystemName: string,
  lines: PosOrderLineInput[],
  ctx: PosServiceContext
): Promise<number> {
  return createPosAdapter(posSystemName).calculateOrderTotal(lines, ctx);
}
