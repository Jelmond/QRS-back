export interface BookingPosConfig {
  [key: string]: unknown;
}

export interface BookingReserveInput {
  customerName: string;
  customerSurname?: string;
  phone: string;
  guestsCount: number;
  posTableIds: string[];
  estimatedStartTime: string;
  durationMinutes?: number;
  comment?: string;
}

export interface BookingReserveResult {
  posReserveId: string;
  creationStatus?: string;
}

export interface IBookingAdapter {
  readonly posSystemName: string;

  createReserve(config: BookingPosConfig, input: BookingReserveInput): Promise<BookingReserveResult>;
  cancelReserve(config: BookingPosConfig, reserveId: string, reason?: string): Promise<void>;
  isTerminalAlive(config: BookingPosConfig): Promise<boolean>;
  getReservesWorkload(
    config: BookingPosConfig,
    sectionIds: string[],
    dateFrom: string,
    dateTo: string
  ): Promise<unknown[]>;
}
