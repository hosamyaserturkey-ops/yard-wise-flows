export interface Booking {
  id: string;
  booking_number: string;
  customer_name: string;
  total_containers: number;
  gated_out_containers: number;
  status: 'active' | 'completed' | 'cancelled';
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateBookingData {
  booking_number: string;
  customer_name: string;
  total_containers: number;
}

export interface GateOutWithDriverData {
  containerId: string;
  bookingNumber: string;
  fees: number;
  driverName: string;
  truckNumber: string;
}