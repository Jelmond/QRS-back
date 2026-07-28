/**
 * iiko Cloud reserve (booking) API.
 * Ported from haratsBooking/iiko_service.py.
 */

import { iikoPost } from './iikoCloudClient';
import type {
  IikoRestaurantConfig,
  IikoReserve,
  IikoReserveInfo,
  IikoReserveInput,
  IikoTerminalAliveStatus,
} from './iikoTypes';

export interface IikoSection {
  id: string;
  name: string;
  tables?: Array<{ id: string; name: string; seatsCount?: number }>;
}

interface TerminalAliveResponse {
  isAliveStatus?: IikoTerminalAliveStatus[];
}

interface ReservesWorkloadResponse {
  reserves?: IikoReserve[];
}

interface ReserveStatusResponse {
  reserves?: IikoReserve[];
}

interface CreateReserveResponse {
  reserveInfo?: IikoReserveInfo;
  errorDescription?: string;
}

/**
 * List available hall sections with their tables.
 * Use this during restaurant setup to map local tables to iiko UUIDs.
 */
export async function fetchIikoSections(
  config: IikoRestaurantConfig
): Promise<IikoSection[]> {
  const data = await iikoPost<{ restaurantSections?: IikoSection[] }>(
    '/api/1/reserve/available_restaurant_sections',
    {
      organizationId: config.organizationId,
      terminalGroupIds: [config.terminalGroupId],
    },
    config.apiLogin
  );
  return data.restaurantSections ?? [];
}

export async function isTerminalAlive(config: IikoRestaurantConfig): Promise<boolean> {
  const data = await iikoPost<TerminalAliveResponse>(
    '/api/1/terminal_groups/is_alive',
    {
      organizationIds: [config.organizationId],
      terminalGroupIds: [config.terminalGroupId],
    },
    config.apiLogin
  );

  for (const status of data.isAliveStatus ?? []) {
    if (status.terminalGroupId === config.terminalGroupId) {
      return status.isAlive;
    }
  }
  return false;
}

/**
 * Fetch existing reserves from iiko for given section IDs and date range.
 * dateFrom / dateTo: ISO format '2026-05-28T00:00:00.000'
 */
export async function getReservesWorkload(
  config: IikoRestaurantConfig,
  sectionIds: string[],
  dateFrom: string,
  dateTo: string
): Promise<IikoReserve[]> {
  if (sectionIds.length === 0) return [];

  const data = await iikoPost<ReservesWorkloadResponse>(
    '/api/1/reserve/restaurant_sections_workload',
    { restaurantSectionIds: sectionIds, dateFrom, dateTo },
    config.apiLogin
  );

  return data.reserves ?? [];
}

export async function getReserveStatus(
  config: IikoRestaurantConfig,
  iiko_reserve_id: string
): Promise<IikoReserve | null> {
  const data = await iikoPost<ReserveStatusResponse>(
    '/api/1/reserve/status_by_id',
    {
      organizationId: config.organizationId,
      reserveIds: [iiko_reserve_id],
    },
    config.apiLogin
  );

  return data.reserves?.[0] ?? null;
}

/**
 * Create a reserve in iiko.
 * iikoTableIds must already be converted to iiko UUIDs before calling this.
 * estimatedStartTime: ISO format '2026-05-28T19:00:00.000'
 */
export async function createIikoReserve(
  config: IikoRestaurantConfig,
  input: IikoReserveInput
): Promise<IikoReserveInfo> {
  const data = await iikoPost<CreateReserveResponse>(
    '/api/1/reserve/create',
    {
      organizationId: config.organizationId,
      terminalGroupId: config.terminalGroupId,
      customer: {
        name: input.customerName,
        surname: input.customerSurname ?? '',
      },
      phone: input.phone,
      guestsCount: input.guestsCount,
      durationInMinutes: input.durationMinutes ?? 120,
      shouldRemind: false,
      estimatedStartTime: input.estimatedStartTime,
      tableIds: input.iikoTableIds,
      comment: input.comment ?? '',
    },
    config.apiLogin
  );

  if (!data.reserveInfo) {
    throw new Error(
      `iiko reserve creation failed: ${data.errorDescription ?? JSON.stringify(data)}`
    );
  }

  return data.reserveInfo;
}

/**
 * Cancel a reserve in iiko.
 * reason: 'Other' | 'ClientRefused'
 */
export async function cancelIikoReserveById(
  config: IikoRestaurantConfig,
  iiko_reserve_id: string,
  reason: 'Other' | 'ClientRefused' = 'Other'
): Promise<void> {
  const data = await iikoPost<{ error?: unknown; errorDescription?: string }>(
    '/api/1/reserve/cancel',
    {
      organizationId: config.organizationId,
      reserveId: iiko_reserve_id,
      cancelReason: reason,
    },
    config.apiLogin
  );

  if (data.error) {
    throw new Error(`iiko cancel failed: ${data.errorDescription ?? JSON.stringify(data)}`);
  }
}
