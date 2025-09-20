export interface Container {
  id: string;
  containerNumber: string;
  containerType: string;
  shippingLine: 'SLD' | 'SLG';
  driverName: string;
  truckNumber: string;
  gateInTime: Date;
  gateOutTime?: Date;
  status: 'in-yard' | 'out' | 'reserved';
  bookingNumber?: string;
  bookingId?: string;
  fees?: number;
}

export interface GateInData {
  containerNumber: string;
  containerType: string;
  shippingLine: 'SLD' | 'SLG';
  driverName: string;
  truckNumber: string;
}

export interface GateOutData {
  containerId: string;
  bookingNumber: string;
  fees: number;
}

export interface Receipt {
  id: string;
  type: 'gate-in' | 'gate-out';
  containerNumber: string;
  driverName: string;
  truckNumber: string;
  timestamp: Date;
  shippingLine: string;
  bookingNumber?: string;
  fees?: number;
}