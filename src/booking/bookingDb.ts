import { getSupabaseClient } from '../db/supabaseClient';
import type { IikoRestaurantConfig } from '../pos/iiko/iikoTypes';
import type { ReservationRow } from './bookingTypes';

export async function getIikoRestaurantConfig(
  restaurantId: string
): Promise<IikoRestaurantConfig | null> {
  const { data, error } = await getSupabaseClient()
    .from('restaurant_pos')
    .select('iiko_api_login, iiko_organization_id, iiko_terminal_group_id')
    .eq('restaurant_id', restaurantId)
    .single();

  if (error || !data || !data.iiko_api_login || !data.iiko_organization_id) return null;

  return {
    apiLogin: data.iiko_api_login,
    organizationId: data.iiko_organization_id,
    terminalGroupId: data.iiko_terminal_group_id ?? '',
  };
}

export async function getReservationWithTables(
  reservationId: string,
  restaurantId: string
): Promise<ReservationRow | null> {
  const supabase = getSupabaseClient();

  const { data: reservation, error } = await supabase
    .from('restaurant_reservations')
    .select('*')
    .eq('id', reservationId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (error || !reservation) return null;

  const { data: tableLinks } = await supabase
    .from('restaurant_reservation_tables')
    .select('table_id')
    .eq('reservation_id', reservationId);

  return {
    id: reservation.id,
    restaurantId: reservation.restaurant_id,
    customerName: reservation.customer_name,
    phone: reservation.phone ?? null,
    guests: reservation.guests,
    note: reservation.note ?? null,
    reservationTime: new Date(reservation.starts_at),
    durationMinutes: reservation.duration_minutes,
    tableIds: (tableLinks ?? []).map((r: { table_id: string }) => r.table_id),
    iikoReserveId: reservation.iiko_reserve_id ?? null,
  };
}

/** Convert local table UUIDs to their iiko UUIDs. Returns only mapped ones. */
export async function getIikoTableIds(localTableIds: string[]): Promise<string[]> {
  if (!localTableIds.length) return [];

  const { data, error } = await getSupabaseClient()
    .from('restaurant_tables')
    .select('iiko_table_id')
    .in('id', localTableIds)
    .not('iiko_table_id', 'is', null);

  if (error || !data) return [];
  return data.map((r: { iiko_table_id: string }) => r.iiko_table_id);
}

/** Get distinct iiko section UUIDs for all tables of a restaurant. */
export async function getIikoSectionIds(restaurantId: string): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from('restaurant_tables')
    .select('iiko_section_id')
    .eq('restaurant_id', restaurantId)
    .not('iiko_section_id', 'is', null);

  if (error || !data) return [];
  return [...new Set(data.map((r: { iiko_section_id: string }) => r.iiko_section_id))];
}

export async function updateReservationIikoStatus(
  reservationId: string,
  iikoReserveId: string,
  creationStatus: string
): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('restaurant_reservations')
    .update({
      iiko_reserve_id: iikoReserveId,
      iiko_creation_status: creationStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reservationId);

  if (error) throw new Error(`updateReservationIikoStatus failed: ${error.message}`);
}

export async function setReservationIikoError(reservationId: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from('restaurant_reservations')
    .update({
      iiko_creation_status: 'Error',
      updated_at: new Date().toISOString(),
    })
    .eq('id', reservationId);

  if (error) throw new Error(`setReservationIikoError failed: ${error.message}`);
}

/** Returns the stored iiko_reserve_id for a reservation, or null. */
export async function getReservationIikoId(
  reservationId: string,
  restaurantId: string
): Promise<string | null> {
  const { data, error } = await getSupabaseClient()
    .from('restaurant_reservations')
    .select('iiko_reserve_id')
    .eq('id', reservationId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (error || !data) return null;
  return data.iiko_reserve_id ?? null;
}

/** Returns the POS system name for a restaurant (e.g. 'iiko', 'rkeeper', 'supabase'). */
export async function getRestaurantPosSystem(restaurantId: string): Promise<string | null> {
  const { data, error } = await getSupabaseClient()
    .from('restaurant_pos')
    .select('pos_type')
    .eq('restaurant_id', restaurantId)
    .single();

  if (error || !data) return null;
  return data.pos_type ?? null;
}

// ── Bidirectional sync helpers ────────────────────────────────────────────────

/** Convert iiko table UUIDs to local restaurant_tables UUIDs. Returns only mapped ones. */
export async function getLocalTableIdsByIikoIds(iikoTableIds: string[]): Promise<string[]> {
  if (!iikoTableIds.length) return [];
  const { data, error } = await getSupabaseClient()
    .from('restaurant_tables')
    .select('id')
    .in('iiko_table_id', iikoTableIds);
  if (error || !data) return [];
  return data.map((r: { id: string }) => r.id);
}

/** Get all local reservations that have an iiko_reserve_id, for a restaurant. */
export async function getLocalReservationsByIikoIds(
  restaurantId: string
): Promise<Array<{ id: string; iiko_reserve_id: string; status: string }>> {
  const { data, error } = await getSupabaseClient()
    .from('restaurant_reservations')
    .select('id, iiko_reserve_id, status')
    .eq('restaurant_id', restaurantId)
    .not('iiko_reserve_id', 'is', null);
  if (error || !data) return [];
  return data;
}

/** Get confirmed reservations with no iiko_reserve_id that start in the future. */
export async function getUnsyncedConfirmedReservations(
  restaurantId: string
): Promise<Array<{ id: string }>> {
  const { data, error } = await getSupabaseClient()
    .from('restaurant_reservations')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'confirmed')
    .is('iiko_reserve_id', null)
    .or('iiko_creation_status.eq.Error,iiko_creation_status.is.null')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at');
  if (error || !data) return [];
  return data;
}

/** Cancel a local reservation that was cancelled in iiko. */
export async function cancelReservationFromIiko(
  iikoReserveId: string,
  restaurantId: string
): Promise<void> {
  await getSupabaseClient()
    .from('restaurant_reservations')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      admin_note: '[cancelled in iiko POS]',
      updated_at: new Date().toISOString(),
    })
    .eq('iiko_reserve_id', iikoReserveId)
    .eq('restaurant_id', restaurantId);
}

/** Link an existing unlinked reservation to an iiko reserve. */
export async function linkReservationToIiko(
  reservationId: string,
  iikoReserveId: string
): Promise<void> {
  await getSupabaseClient()
    .from('restaurant_reservations')
    .update({
      iiko_reserve_id: iikoReserveId,
      iiko_creation_status: 'Success',
      updated_at: new Date().toISOString(),
    })
    .eq('id', reservationId);
}

/**
 * Try to find an unlinked local reservation that matches an iiko reserve
 * by time (within 5 min) and guest count.
 */
export async function findUnlinkedReservationMatch(
  restaurantId: string,
  estimatedStartTime: Date,
  guestsCount: number
): Promise<string | null> {
  const from = new Date(estimatedStartTime.getTime() - 5 * 60 * 1000).toISOString();
  const to   = new Date(estimatedStartTime.getTime() + 5 * 60 * 1000).toISOString();

  const { data, error } = await getSupabaseClient()
    .from('restaurant_reservations')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .is('iiko_reserve_id', null)
    .in('status', ['confirmed', 'pending'])
    .eq('guests', guestsCount)
    .gte('starts_at', from)
    .lte('starts_at', to)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !data?.length) return null;
  return data[0].id;
}

/** Create a local reservation from iiko reserve data. */
export async function createReservationFromIiko(payload: {
  restaurantId: string;
  customerName: string;
  phone: string;
  guests: number;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  note: string;
  iikoReserveId: string;
  tableIds: string[];
}): Promise<string | null> {
  const confirmationCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from('restaurant_reservations')
    .insert({
      restaurant_id:        payload.restaurantId,
      customer_name:        payload.customerName,
      phone:                payload.phone || null,
      guests:               payload.guests,
      starts_at:            payload.startsAt.toISOString(),
      ends_at:              payload.endsAt.toISOString(),
      duration_minutes:     payload.durationMinutes,
      note:                 payload.note || null,
      status:               'confirmed',
      confirmation_code:    confirmationCode,
      created_by_admin:     false,
      admin_note:           '[created from iiko POS]',
      iiko_reserve_id:      payload.iikoReserveId,
      iiko_creation_status: 'Success',
      updated_at:           new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) return null;

  if (payload.tableIds.length) {
    await supabase
      .from('restaurant_reservation_tables')
      .insert(payload.tableIds.map(tid => ({
        reservation_id: data.id,
        table_id: tid,
      })));
  }

  return data.id;
}
