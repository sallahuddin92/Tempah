export interface Room {
  id: number;
  name: string;
  capacity: number;
  type: 'conference' | 'hall' | 'meeting';
}

export interface Booking {
  id?: number;
  room_name: string;
  date: string;
  hour: number;
  user_name: string;
  reason: string;
  created_at?: string;
}

export interface SlotAvailability {
  hour: number;
  isBooked: boolean;
  booking: Booking | null;
}
