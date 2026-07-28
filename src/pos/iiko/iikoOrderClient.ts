/**
 * iiko Cloud table-service order API.
 * Used to push QRS orders to the iiko terminal.
 */

import { iikoPost } from './iikoCloudClient';
import type { IikoRestaurantConfig } from './iikoTypes';

export interface IikoOrderModifier {
  productId: string;
  quantity: number;
  price: number;
}

export interface IikoOrderItem {
  productId: string;
  quantity: number;
  price: number;
  comment?: string;
  modifiers?: IikoOrderModifier[];
}

export interface IikoOrderInput {
  tableIds: string[];
  guestsCount: number;
  items: IikoOrderItem[];
  comment?: string;
  phone?: string;
}

export interface IikoOrderInfo {
  id: string;
  status: string;
  number?: number;
  sum?: number;
}

/**
 * Create a table-service order in iiko.
 * tableIds must already be converted to iiko UUIDs.
 */
export async function createIikoTableOrder(
  config: IikoRestaurantConfig,
  input: IikoOrderInput
): Promise<IikoOrderInfo> {
  const data = await iikoPost<{ orderInfo?: IikoOrderInfo; errorDescription?: string }>(
    '/api/1/order/create',
    {
      organizationId: config.organizationId,
      terminalGroupId: config.terminalGroupId,
      order: {
        tableIds: input.tableIds,
        guestsCount: input.guestsCount,
        comment: input.comment ?? '',
        phone: input.phone ?? '',
        items: input.items.map((item) => ({
          productId: item.productId,
          amount: item.quantity,
          sum: item.price * item.quantity,
          price: item.price,
          comment: item.comment ?? '',
          type: 'Product',
          modifiers: item.modifiers ?? [],
        })),
      },
    },
    config.apiLogin
  );

  if (!data.orderInfo) {
    throw new Error(
      `iiko order creation failed: ${data.errorDescription ?? JSON.stringify(data)}`
    );
  }

  return data.orderInfo;
}

/** Cancel an order in iiko. */
export async function cancelIikoOrder(
  config: IikoRestaurantConfig,
  orderId: string
): Promise<void> {
  await iikoPost(
    '/api/1/order/cancel',
    { organizationId: config.organizationId, orderId },
    config.apiLogin
  );
}

/** Get current status of one or more orders by their iiko IDs. */
export async function getIikoOrderStatus(
  config: IikoRestaurantConfig,
  orderIds: string[]
): Promise<IikoOrderInfo[]> {
  const data = await iikoPost<{ orders?: IikoOrderInfo[] }>(
    '/api/1/order/by_id',
    {
      organizationIds: [config.organizationId],
      orderIds,
    },
    config.apiLogin
  );
  return data.orders ?? [];
}
