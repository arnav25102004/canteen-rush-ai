'use client';
import { useEffect, useState, useCallback } from 'react';
import Sidebar from '../../../components/shared/Sidebar';
import api from '../../../lib/api';

interface MenuItem {
  id: string; name: string; price: number; isVeg: boolean; isAvailable: boolean;
  isPopular: boolean; prepTimeMinutes: number; description?: string;
}
interface Category {
  id: string; name: string; items: MenuItem[];
}

export default function MenuPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [form, setForm] = useState({ name: '', price: '', categoryId: '', description: '', prepTimeMinutes: '10', isVeg: true });

  // Vendor's own menu, including unavailable items (the public menu hides them,
  // which used to make toggled-off items vanish with no way to turn them back on).
  const load = useCallback(async () => {
    const { data } = await api.get('/vendor/my-menu');
    setCategories(data.categories || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const errorText = (e: any) => {
    const err = e?.response?.data?.error;
    return typeof err === 'string' ? err : 'Request failed. Check the fields and try again.';
  };

  async function toggleAvailability(itemId: string) {
    await api.patch(`/vendor/items/${itemId}/availability`);
    load();
  }

  async function addCategory() {
    if (!newCategory.trim()) return;
    try {
      await api.post('/vendor/categories', { name: newCategory.trim() });
      setNewCategory('');
      load();
    } catch (e) { alert(errorText(e)); }
  }

  async function addItem() {
    try {
      await api.post('/vendor/items', {
        ...form,
        description: form.description || undefined,
        price: parseFloat(form.price),
        prepTimeMinutes: parseInt(form.prepTimeMinutes),
      });
      setShowForm(false);
      setForm({ name: '', price: '', categoryId: '', description: '', prepTimeMinutes: '10', isVeg: true });
      load();
    } catch (e) { alert(errorText(e)); }
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 bg-gray-50">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Menu Management</h1>
          <div className="flex gap-2">
            <input placeholder="New category" value={newCategory} onChange={e => setNewCategory(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm" />
            <button onClick={addCategory} className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm font-medium">
              + Category
            </button>
          <button onClick={() => setShowForm(!showForm)}
            className="bg-[#e94560] text-white px-4 py-2 rounded-lg text-sm font-medium">
            + Add Item
          </button>
          </div>
        </div>

        {showForm && (
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
            <h2 className="font-semibold mb-4">New Menu Item</h2>
            <div className="grid grid-cols-2 gap-4">
              <input placeholder="Item name" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
                className="border rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Price (₹)" type="number" value={form.price} onChange={e => setForm({...form, price: e.target.value})}
                className="border rounded-lg px-3 py-2 text-sm" />
              <select value={form.categoryId} onChange={e => setForm({...form, categoryId: e.target.value})}
                className="border rounded-lg px-3 py-2 text-sm">
                <option value="">Select Category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input placeholder="Prep time (min)" type="number" value={form.prepTimeMinutes}
                onChange={e => setForm({...form, prepTimeMinutes: e.target.value})}
                className="border rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Description (optional)" value={form.description}
                onChange={e => setForm({...form, description: e.target.value})}
                className="border rounded-lg px-3 py-2 text-sm col-span-2" />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isVeg} onChange={e => setForm({...form, isVeg: e.target.checked})} />
                Veg
              </label>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={addItem} className="bg-[#1a1a2e] text-white px-4 py-2 rounded-lg text-sm">Save</button>
              <button onClick={() => setShowForm(false)} className="text-gray-500 text-sm">Cancel</button>
            </div>
          </div>
        )}

        {categories.map((cat) => (
          <div key={cat.id} className="bg-white rounded-xl shadow-sm mb-4">
            <div className="px-6 py-4 border-b font-semibold text-gray-700">{cat.name}</div>
            <div className="divide-y">
              {cat.items.map((item) => (
                <div key={item.id} className="flex items-center justify-between px-6 py-4">
                  <div className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full ${item.isVeg ? 'bg-green-500' : 'bg-red-500'}`} />
                    <div>
                      <p className="font-medium text-sm">{item.name}</p>
                      <p className="text-xs text-gray-500">₹{Number(item.price).toFixed(0)} • {item.prepTimeMinutes} min</p>
                    </div>
                    {item.isPopular && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Popular</span>}
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-gray-500">{item.isAvailable ? 'Available' : 'Sold Out'}</span>
                    <div
                      onClick={() => toggleAvailability(item.id)}
                      className={`w-10 h-6 rounded-full transition-colors ${item.isAvailable ? 'bg-green-500' : 'bg-gray-300'} relative cursor-pointer`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${item.isAvailable ? 'translate-x-5' : 'translate-x-1'}`} />
                    </div>
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
