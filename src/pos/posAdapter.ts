import type { PosOrderLineInput, PosProduct, PosServiceContext, PosSystemName } from './types';

export interface IPosAdapter {
  readonly systemName: PosSystemName;

  /** Load sellable products with current prices (and availability when the API exposes it). */
  getProducts(ctx: PosServiceContext): Promise<PosProduct[]>;

  /** Sum line totals using POS prices (same rules as `getProducts` pricing). */
  calculateOrderTotal(lines: PosOrderLineInput[], ctx: PosServiceContext): Promise<number>;
}
