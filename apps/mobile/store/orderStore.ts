import { create } from 'zustand';
import api from '../services/api';

export type OrderStatus = 'CONFIRMED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'PICKED_UP' | 'CANCELLED';

export interface OrderItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  estimatedPickupTime?: string;
  canteen?: { id: string; name: string };
  items: OrderItem[];
  createdAt: string;
}

interface OrderStore {
  orders: Order[];
  activeOrder: Order | null;
  loading: boolean;
  fetchOrders: () => Promise<void>;
  fetchOrder: (id: string) => Promise<void>;
  setActiveOrder: (order: Order | null) => void;
}

export const useOrderStore = create<OrderStore>((set) => ({
  orders: [],
  activeOrder: null,
  loading: false,

  fetchOrders: async () => {
    set({ loading: true });
    try {
      const { data } = await api.get('/orders');
      set({ orders: data.orders || [] });
    } finally {
      set({ loading: false });
    }
  },

  fetchOrder: async (id: string) => {
    const { data } = await api.get(`/orders/${id}`);
    set({ activeOrder: data.order });
  },

  setActiveOrder: (order) => set({ activeOrder: order }),
}));
