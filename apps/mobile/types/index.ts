export type UserRole = 'STUDENT' | 'FACULTY' | 'VENDOR' | 'ADMIN';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  canteenId?: string;
  campus?: string;
  dietPreference?: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  category: string;
  isVeg: boolean;
  isAvailable: boolean;
  imageUrl?: string;
  preparationTime?: number;
}

export interface Canteen {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  isOpen: boolean;
  campus: string;
  openTime?: string;
  closeTime?: string;
}

export type OrderStatus = 'CONFIRMED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'CANCELLED';

export interface OrderItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  customizations?: Record<string, string>;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  estimatedPickupTime?: string;
  canteen?: Canteen;
  items: OrderItem[];
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string;
  createdAt: string;
}

export interface Wallet {
  balance: number;
  transactions: WalletTransaction[];
}
