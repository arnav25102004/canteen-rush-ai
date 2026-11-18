import { create } from 'zustand';

export interface CartItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  isVeg: boolean;
  customizations?: Record<string, string>;
}

export interface CartSlot {
  id: string;
  startTime: string;
  endTime: string;
  date: string;
}

interface CartStore {
  canteenId: string | null;
  canteenName: string | null;
  items: CartItem[];
  slot: CartSlot | null;
  setSlot: (slot: CartSlot | null) => void;
  /** Replaces the whole cart in one step (reorder, assistant hand-off). */
  replaceCart: (canteenId: string, canteenName: string, items: CartItem[], slot?: CartSlot | null) => void;
  addItem: (canteenId: string, canteenName: string, item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (menuItemId: string) => void;
  updateQty: (menuItemId: string, quantity: number) => void;
  clear: () => void;
  total: () => number;
  itemCount: () => number;
}

export const useCartStore = create<CartStore>((set, get) => ({
  canteenId: null,
  canteenName: null,
  items: [],
  slot: null,

  setSlot: (slot) => set({ slot }),

  replaceCart: (canteenId, canteenName, items, slot = null) =>
    set({ canteenId, canteenName, items: items.filter((i) => i.quantity > 0), slot }),

  addItem: (canteenId, canteenName, item) => {
    const { items, canteenId: currentCanteen } = get();
    // Clear cart if switching canteens
    const startFresh = currentCanteen !== canteenId;
    const existing = startFresh ? null : items.find((i) => i.menuItemId === item.menuItemId);
    if (existing) {
      set({ items: items.map((i) => i.menuItemId === item.menuItemId ? { ...i, quantity: i.quantity + 1 } : i) });
    } else {
      set({
        canteenId,
        canteenName,
        items: startFresh ? [{ ...item, quantity: 1 }] : [...items, { ...item, quantity: 1 }],
        // A slot belongs to one canteen: drop it when the canteen changes.
        ...(startFresh ? { slot: null } : {}),
      });
    }
  },

  removeItem: (menuItemId) => set((s) => ({ items: s.items.filter((i) => i.menuItemId !== menuItemId) })),

  updateQty: (menuItemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(menuItemId);
    } else {
      set((s) => ({ items: s.items.map((i) => i.menuItemId === menuItemId ? { ...i, quantity } : i) }));
    }
  },

  clear: () => set({ canteenId: null, canteenName: null, items: [], slot: null }),

  total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

  itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
}));
