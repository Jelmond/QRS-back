/**
 * Bidirectional iiko ↔ local reservation sync.
 * Ported from haratsBooking/retry_iiko_sync.py.
 *
 * 1. Local → iiko : push confirmed reservations that failed to reach iiko
 * 2. iiko → local : pull iiko reserves for the next N days
 *    - New in iiko, missing locally  → create local reservation
 *    - Cancelled in iiko, confirmed locally → cancel locally
 *    - Cancelled locally, active in iiko   → cancel in iiko
 *    - Unlinked local match found (time ±5min + guests) → link instead of creating
 */

import { getIikoRestaurantConfig } from './bookingDb';
import {
  getLocalReservationsByIikoIds,
  getUnsyncedConfirmedReservations,
  cancelReservationFromIiko,
  linkReservationToIiko,
  findUnlinkedReservationMatch,
  createReservationFromIiko,
  getLocalTableIdsByIikoIds,
  getIikoSectionIds,
} from './bookingDb';
import { syncReservationToPos, cancelPosReserveForReservation } from './bookingService';
import {
  isTerminalAlive,
  getReservesWorkload,
  getReserveStatus,
  fetchIikoSections,
} from '../pos/iiko/iikoReserveClient';
import { fetchIikoTerminalGroups } from '../pos/iiko/iikoCloudClient';
import type { IikoRestaurantConfig } from '../pos/iiko/iikoTypes';

const SYNC_DAYS_AHEAD = parseInt(process.env.IIKO_SYNC_DAYS_AHEAD ?? '14', 10);
const SLOT_MINUTES    = parseInt(process.env.SLOT_MINUTES ?? '120', 10);

export interface ReservationSyncResult {
  pushed:          number;
  created:         number;
  linked:          number;
  cancelledLocal:  number;
  cancelledIiko:   number;
}

function toIikoTimestamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.000`
  );
}

function parseIikoTime(raw: string): Date | null {
  try {
    return new Date(raw.replace(' ', 'T').split('.')[0]);
  } catch {
    return null;
  }
}

// ── 1. Local → iiko ──────────────────────────────────────────────────────────

async function pushLocalToIiko(restaurantId: string): Promise<number> {
  const rows = await getUnsyncedConfirmedReservations(restaurantId);
  let pushed = 0;
  for (const row of rows) {
    await syncReservationToPos(row.id, restaurantId);
    pushed++;
  }
  if (pushed) console.info(`[sync] Local→iiko: pushed ${pushed} reservation(s) for restaurant ${restaurantId}`);
  return pushed;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * If the config has no terminalGroupId (e.g. restaurant was set up without it),
 * fetch terminal groups from iiko and use the first one.
 */
async function resolveTerminalGroupId(config: IikoRestaurantConfig): Promise<IikoRestaurantConfig> {
  if (config.terminalGroupId) return config;
  const groups = await fetchIikoTerminalGroups([config.organizationId as string], config.apiLogin);
  if (!groups.length) return config;
  console.info(`[sync] Resolved terminalGroupId from iiko: ${groups[0].id} (${groups[0].name})`);
  return { ...config, terminalGroupId: groups[0].id };
}

// ── 2. iiko → local ──────────────────────────────────────────────────────────

async function pullIikoToLocal(
  restaurantId: string
): Promise<Omit<ReservationSyncResult, 'pushed'>> {
  const config = await getIikoRestaurantConfig(restaurantId);
  if (!config) return { created: 0, linked: 0, cancelledLocal: 0, cancelledIiko: 0 };

  // Prefer section IDs stored in local table mappings.
  // Fall back to fetching all sections directly from iiko (e.g. on first sync before tables are mapped).
  let sectionIds = await getIikoSectionIds(restaurantId);
  if (!sectionIds.length) {
    console.info(`[sync] No local section mappings for restaurant ${restaurantId} — fetching sections from iiko`);
    try {
      const effectiveConfig = await resolveTerminalGroupId(config);
      if (effectiveConfig.terminalGroupId) {
        const sections = await fetchIikoSections(effectiveConfig);
        sectionIds = sections.map(s => s.id);
      }
    } catch (e) {
      console.error(`[sync] Failed to fetch iiko sections:`, e);
    }
  }
  if (!sectionIds.length) {
    console.warn(`[sync] No sections found in iiko for restaurant ${restaurantId} — skipping pull`);
    return { created: 0, linked: 0, cancelledLocal: 0, cancelledIiko: 0 };
  }

  const now    = new Date();
  const future = new Date(now.getTime() + SYNC_DAYS_AHEAD * 24 * 60 * 60 * 1000);
  const dateFrom = toIikoTimestamp(now);
  // End of the last day in the window
  future.setHours(23, 59, 59, 0);
  const dateTo = toIikoTimestamp(future);

  const iikoReserves = await getReservesWorkload(config, sectionIds, dateFrom, dateTo);

  const localRows   = await getLocalReservationsByIikoIds(restaurantId);
  const localByIikoId = new Map(localRows.map(r => [r.iiko_reserve_id, r]));

  const stats = { created: 0, linked: 0, cancelledLocal: 0, cancelledIiko: 0 };
  const iikoActiveIds = new Set<string>();

  for (const reserve of iikoReserves) {
    const iikoId    = reserve.id as string;
    const iikoStatus = (reserve.status as string) ?? '';
    if (!iikoId) continue;
    iikoActiveIds.add(iikoId);

    const localRow = localByIikoId.get(iikoId);

    if (localRow) {
      // Cancelled in iiko but confirmed locally → cancel locally
      if (['Cancelled', 'Deleted'].includes(iikoStatus) && localRow.status === 'confirmed') {
        await cancelReservationFromIiko(iikoId, restaurantId);
        console.info(`[sync] Cancelled local reservation for iiko reserve ${iikoId}`);
        stats.cancelledLocal++;
      }
      // Cancelled locally but still active in iiko → cancel in iiko
      else if (localRow.status === 'cancelled' && !['Cancelled', 'Deleted'].includes(iikoStatus)) {
        try {
          await cancelPosReserveForReservation(localRow.id, restaurantId);
          console.info(`[sync] Cancelled iiko reserve ${iikoId} (local cancelled)`);
          stats.cancelledIiko++;
        } catch (e) {
          console.error(`[sync] Failed to cancel iiko reserve ${iikoId}:`, e);
        }
      }
    } else {
      // Not in local DB at all
      const linked = await tryLinkExisting(restaurantId, reserve);
      if (linked) {
        stats.linked++;
      } else {
        const created = await createFromIiko(restaurantId, config, reserve);
        if (created) stats.created++;
      }
    }
  }

  // Check confirmed local reservations linked to iiko that vanished from workload
  for (const localRow of localRows) {
    if (localRow.status !== 'confirmed') continue;
    if (iikoActiveIds.has(localRow.iiko_reserve_id)) continue;

    try {
      const statusData = await getReserveStatus(config, localRow.iiko_reserve_id);
      if (!statusData) continue;
      const detail     = (statusData as any).reserve ?? {};
      const isDeleted  = (statusData as any).isDeleted;
      const detailStatus = detail.status ?? '';
      if (isDeleted || ['Cancelled', 'Deleted'].includes(detailStatus)) {
        await cancelReservationFromIiko(localRow.iiko_reserve_id, restaurantId);
        console.info(`[sync] Cancelled local reservation — iiko reserve ${localRow.iiko_reserve_id} deleted/missing`);
        stats.cancelledLocal++;
      }
    } catch (e) {
      console.error(`[sync] Failed to check status of iiko reserve ${localRow.iiko_reserve_id}:`, e);
    }
  }

  console.info(
    `[sync] iiko→local for restaurant ${restaurantId}: ` +
    `created=${stats.created} linked=${stats.linked} ` +
    `cancelledLocal=${stats.cancelledLocal} cancelledIiko=${stats.cancelledIiko}`
  );
  return stats;
}

async function tryLinkExisting(restaurantId: string, reserve: Record<string, unknown>): Promise<boolean> {
  const iikoId   = reserve.id as string;
  const timeRaw  = reserve.estimatedStartTime as string | undefined;
  const guests   = (reserve.guestsCount as number) ?? 0;

  if (!timeRaw) return false;
  const startTime = parseIikoTime(timeRaw);
  if (!startTime) return false;

  const matchId = await findUnlinkedReservationMatch(restaurantId, startTime, guests);
  if (!matchId) return false;

  await linkReservationToIiko(matchId, iikoId);
  console.info(`[sync] Linked local reservation ${matchId} to iiko reserve ${iikoId}`);
  return true;
}

async function createFromIiko(
  restaurantId: string,
  config: Awaited<ReturnType<typeof getIikoRestaurantConfig>>,
  reserve: Record<string, unknown>
): Promise<boolean> {
  const iikoId     = reserve.id as string;
  const iikoStatus = (reserve.status as string) ?? '';

  if (['Cancelled', 'Deleted'].includes(iikoStatus)) return false;

  // Fetch full details for phone number etc.
  let src = { ...reserve };
  try {
    const statusData = await getReserveStatus(config!, iikoId);
    if ((statusData as any)?.isDeleted) return false;
    const detail = (statusData as any)?.reserve ?? {};
    if (['Cancelled', 'Deleted'].includes(detail.status ?? '')) return false;
    src = { ...src, ...Object.fromEntries(Object.entries(detail).filter(([, v]) => v != null)) };
  } catch {
    // Use workload data as fallback
  }

  const customer = (src.customer as any) ?? {};
  const nameParts = [customer.name, customer.surname].filter(Boolean);
  const customerName = nameParts.join(' ') || 'iiko Guest';
  const phone        = (src.phone as string) ?? '';
  const guests       = (src.guestsCount as number) ?? 1;
  const comment      = (src.comment as string) ?? '';
  const duration     = (src.durationInMinutes as number) ?? SLOT_MINUTES;

  const timeRaw = src.estimatedStartTime as string | undefined;
  if (!timeRaw) {
    console.warn(`[sync] iiko reserve ${iikoId} has no estimatedStartTime — skipping`);
    return false;
  }
  const startsAt = parseIikoTime(timeRaw);
  if (!startsAt) {
    console.error(`[sync] Cannot parse time '${timeRaw}' for iiko reserve ${iikoId}`);
    return false;
  }
  const endsAt = new Date(startsAt.getTime() + duration * 60 * 1000);

  const iikoTableIds  = (src.tableIds as string[]) ?? [];
  const localTableIds = await getLocalTableIdsByIikoIds(iikoTableIds);

  const newId = await createReservationFromIiko({
    restaurantId,
    customerName,
    phone,
    guests,
    startsAt,
    endsAt,
    durationMinutes: duration,
    note: comment,
    iikoReserveId: iikoId,
    tableIds: localTableIds,
  });

  if (newId) {
    console.info(`[sync] Created local reservation ${newId} from iiko reserve ${iikoId} (${customerName}, ${guests} guests)`);
    return true;
  }
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Full bidirectional sync for one restaurant.
 * Returns false if terminal is offline.
 */
export async function syncRestaurantReservations(
  restaurantId: string
): Promise<{ ok: false; reason: string } | ({ ok: true } & ReservationSyncResult)> {
  const config = await getIikoRestaurantConfig(restaurantId);
  if (!config) return { ok: false, reason: 'POS not configured' };

  const alive = await isTerminalAlive(config).catch(() => false);
  if (!alive) return { ok: false, reason: 'Terminal offline' };

  const pushed = await pushLocalToIiko(restaurantId);
  const pullStats = await pullIikoToLocal(restaurantId);

  return { ok: true, pushed, ...pullStats };
}
