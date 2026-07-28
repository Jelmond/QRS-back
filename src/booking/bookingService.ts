/**
 * Booking ↔ POS sync service.
 * Ported from haratsBooking/booking_service.py.
 * Uses the booking adapter pattern — supports iiko, R-Keeper, Supabase.
 */

import {
  getIikoRestaurantConfig,
  getReservationWithTables,
  getIikoTableIds,
  updateReservationIikoStatus,
  setReservationIikoError,
  getReservationIikoId,
  getRestaurantPosSystem,
} from './bookingDb';
import { createBookingAdapter } from './createBookingAdapter';

function splitCustomerName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
}

function toIikoTimestamp(dt: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` +
    `T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}.000`
  );
}

/**
 * Push a confirmed local reservation into the restaurant's POS system.
 * Stores the POS reserve ID and creation status back on the reservation row.
 */
export async function syncReservationToPos(
  reservationId: string,
  restaurantId: string
): Promise<void> {
  const posSystemName = await getRestaurantPosSystem(restaurantId);
  if (!posSystemName) {
    console.warn(`[booking] No POS system for restaurant ${restaurantId} — skipping sync`);
    return;
  }

  const reservation = await getReservationWithTables(reservationId, restaurantId);
  if (!reservation) {
    console.warn(`[booking] Reservation ${reservationId} not found — skipping sync`);
    return;
  }

  if (!reservation.tableIds.length) {
    console.warn(`[booking] Reservation ${reservationId} has no tables — skipping sync`);
    return;
  }

  const posTableIds = await getIikoTableIds(reservation.tableIds);
  if (!posTableIds.length) {
    console.warn(`[booking] No POS table mapping for reservation ${reservationId} — skipping sync`);
    return;
  }

  const config = await getIikoRestaurantConfig(restaurantId);
  if (!config) {
    console.warn(`[booking] No POS config for restaurant ${restaurantId} — skipping sync`);
    return;
  }

  const { firstName, lastName } = splitCustomerName(reservation.customerName);

  try {
    const adapter = createBookingAdapter(posSystemName);
    const result = await adapter.createReserve(config, {
      customerName: firstName,
      customerSurname: lastName || undefined,
      phone: reservation.phone ?? '+000000000',
      guestsCount: reservation.guests,
      posTableIds,
      estimatedStartTime: toIikoTimestamp(reservation.reservationTime),
      durationMinutes: reservation.durationMinutes,
      comment: reservation.note ?? '',
    });

    await updateReservationIikoStatus(
      reservationId,
      result.posReserveId,
      result.creationStatus ?? 'InProgress'
    );

    console.info(
      `[booking] Reservation ${reservationId} synced to ${posSystemName} → reserve ${result.posReserveId}`
    );
  } catch (err) {
    await setReservationIikoError(reservationId);
    console.error(`[booking] Failed to sync reservation ${reservationId} to ${posSystemName}:`, err);
  }
}

/**
 * Cancel the POS reserve linked to a reservation, if one exists.
 * Safe to call on reservations that were never synced.
 */
export async function cancelPosReserveForReservation(
  reservationId: string,
  restaurantId: string
): Promise<void> {
  const posSystemName = await getRestaurantPosSystem(restaurantId);
  if (!posSystemName) return;

  const posReserveId = await getReservationIikoId(reservationId, restaurantId);
  if (!posReserveId) return;

  const config = await getIikoRestaurantConfig(restaurantId);
  if (!config) return;

  try {
    const adapter = createBookingAdapter(posSystemName);
    await adapter.cancelReserve(config, posReserveId, 'Other');
    console.info(
      `[booking] Cancelled ${posSystemName} reserve ${posReserveId} for reservation ${reservationId}`
    );
  } catch (err) {
    console.error(
      `[booking] Failed to cancel ${posSystemName} reserve for reservation ${reservationId}:`,
      err
    );
  }
}
