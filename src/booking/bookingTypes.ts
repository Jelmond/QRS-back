export interface ReservationRow {
  id: string;
  restaurantId: string;
  customerName: string;
  phone: string | null;
  guests: number;
  note: string | null;
  reservationTime: Date;
  durationMinutes: number;
  tableIds: string[];
  iikoReserveId?: string | null;
}
