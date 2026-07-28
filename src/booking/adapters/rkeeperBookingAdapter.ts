import type { IBookingAdapter, BookingPosConfig, BookingReserveInput, BookingReserveResult } from '../IBookingAdapter';

export const rkeeperBookingAdapter: IBookingAdapter = {
  posSystemName: 'rkeeper',

  async createReserve(_config: BookingPosConfig, _input: BookingReserveInput): Promise<BookingReserveResult> {
    throw new Error('R-Keeper booking: createReserve not implemented');
  },

  async cancelReserve(_config: BookingPosConfig, _reserveId: string, _reason?: string): Promise<void> {
    throw new Error('R-Keeper booking: cancelReserve not implemented');
  },

  async isTerminalAlive(_config: BookingPosConfig): Promise<boolean> {
    throw new Error('R-Keeper booking: isTerminalAlive not implemented');
  },

  async getReservesWorkload(
    _config: BookingPosConfig,
    _sectionIds: string[],
    _dateFrom: string,
    _dateTo: string
  ): Promise<unknown[]> {
    throw new Error('R-Keeper booking: getReservesWorkload not implemented');
  },
};
