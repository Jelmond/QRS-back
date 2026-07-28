import type { IBookingAdapter, BookingPosConfig, BookingReserveInput, BookingReserveResult } from '../IBookingAdapter';
import type { IikoRestaurantConfig } from '../../pos/iiko/iikoTypes';
import {
  createIikoReserve,
  cancelIikoReserveById,
  isTerminalAlive,
  getReservesWorkload,
} from '../../pos/iiko/iikoReserveClient';

function toIikoConfig(config: BookingPosConfig): IikoRestaurantConfig {
  return config as unknown as IikoRestaurantConfig;
}

export const iikoBookingAdapter: IBookingAdapter = {
  posSystemName: 'iiko',

  async createReserve(config: BookingPosConfig, input: BookingReserveInput): Promise<BookingReserveResult> {
    const info = await createIikoReserve(toIikoConfig(config), {
      customerName: input.customerName,
      customerSurname: input.customerSurname,
      phone: input.phone,
      guestsCount: input.guestsCount,
      iikoTableIds: input.posTableIds,
      estimatedStartTime: input.estimatedStartTime,
      durationMinutes: input.durationMinutes,
      comment: input.comment,
    });
    return { posReserveId: info.id, creationStatus: info.creationStatus };
  },

  async cancelReserve(config: BookingPosConfig, reserveId: string, reason?: string): Promise<void> {
    await cancelIikoReserveById(
      toIikoConfig(config),
      reserveId,
      (reason as 'Other' | 'ClientRefused') ?? 'Other'
    );
  },

  async isTerminalAlive(config: BookingPosConfig): Promise<boolean> {
    return isTerminalAlive(toIikoConfig(config));
  },

  async getReservesWorkload(
    config: BookingPosConfig,
    sectionIds: string[],
    dateFrom: string,
    dateTo: string
  ): Promise<unknown[]> {
    return getReservesWorkload(toIikoConfig(config), sectionIds, dateFrom, dateTo);
  },
};
