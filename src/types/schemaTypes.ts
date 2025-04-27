// Database schema interfaces
export interface MenuItem {
  id: string; // UUID
  name: string;
  description: string;
  price: number;
  image: string;
  category_id: string; // UUID
  allergens?: string[];
  dietary_preferences?: string[];
  is_popular?: boolean;
  created_at: Date;
  restaurant_id?: string; // UUID
  self_price?: number;
  is_available: boolean;
  meal_periods?: string[];
  is_deleted: boolean;
}

export interface Order {
  id: string; // UUID
  table_number: string;
  status: string; // 'pending', etc.
  total: number;
  incremented_id: number;
  // Missing fields that should be added:
  restaurant_id: string;
  guest_profile_id: string;
  // created_at: Date;
  // updated_at?: Date;
  // payment_status?: string;
}

export interface OrderItem {
  id: string; // UUID
  order_id: string; // UUID
  menu_item_id: string; // UUID
  quantity: number;
  price: number;
  created_at: Date;
  self_price?: number;
}

export interface Payment {
  id: string; // UUID
  order_id: string; // UUID
  restaurant_id: string; // UUID
  guest_profile_id: string; // UUID
  status: PaymentStatus; // Using enum type
  amount: number;
  hash_id: string; // External payment ID from Alfa Bank
  created_at: Date;
  updated_at: Date;
  payment_link?: string; // Not in DB schema but used in code
}

// Enum for payment status to match the database type
export type PaymentStatus = 'pending' | 'success' | 'failure';
