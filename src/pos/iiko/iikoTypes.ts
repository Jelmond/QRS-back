export interface IikoRestaurantConfig {
  apiLogin: string;
  organizationId: string;
  terminalGroupId: string;
  [key: string]: unknown;
}

export interface IikoReserveInfo {
  id: string;
  creationStatus?: string;
}

export interface IikoReserveInput {
  customerName: string;
  customerSurname?: string;
  phone: string;
  guestsCount: number;
  iikoTableIds: string[];
  estimatedStartTime: string;
  durationMinutes?: number;
  comment?: string;
}

export interface IikoReserve {
  id: string;
  status?: string;
  tableIds?: string[];
  guestsCount?: number;
  startTime?: string;
  [key: string]: unknown;
}

export interface IikoTerminalAliveStatus {
  terminalGroupId: string;
  isAlive: boolean;
}
