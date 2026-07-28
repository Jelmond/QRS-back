import type { IBookingAdapter, BookingPosConfig, BookingReserveInput, BookingReserveResult } from '../IBookingAdapter';

// Supabase/internal restaurants manage bookings locally — no external POS sync needed.
export const supabaseBookingAdapter: IBookingAdapter = {
  posSystemName: 'supabase',

  async createReserve(_config: BookingPosConfig, _input: BookingReserveInput): Promise<BookingReserveResult> {
    throw new Error('Supabase booking: createReserve not implemented');
  },

  async cancelReserve(_config: BookingPosConfig, _reserveId: string, _reason?: string): Promise<void> {
    throw new Error('Supabase booking: cancelReserve not implemented');
  },

  async isTerminalAlive(_config: BookingPosConfig): Promise<boolean> {
    throw new Error('Supabase booking: isTerminalAlive not implemented');
  },

  async getReservesWorkload(
    _config: BookingPosConfig,
    _sectionIds: string[],
    _dateFrom: string,
    _dateTo: string
  ): Promise<unknown[]> {
    throw new Error('Supabase booking: getReservesWorkload not implemented');
  },
};
