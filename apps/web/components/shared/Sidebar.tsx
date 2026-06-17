'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const vendorLinks = [
  { href: '/vendor/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/vendor/orders', label: 'Orders', icon: '📋' },
  { href: '/vendor/menu', label: 'Menu', icon: '🍽️' },
  { href: '/vendor/scanner', label: 'QR Scanner', icon: '📷' },
  { href: '/vendor/analytics', label: 'Analytics', icon: '📈' },
];

const adminLinks = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/admin/canteens', label: 'Canteens', icon: '🏪' },
  { href: '/admin/vendors', label: 'Vendors', icon: '👤' },
  { href: '/admin/users', label: 'Users', icon: '👥' },
  { href: '/admin/settlements', label: 'Settlements', icon: '💰' },
  { href: '/admin/analytics', label: 'Analytics', icon: '📈' },
  { href: '/admin/announcements', label: 'Announcements', icon: '📢' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState<string>('VENDOR');

  useEffect(() => {
    setRole(localStorage.getItem('user_role') || 'VENDOR');
  }, []);

  const links = role === 'ADMIN' ? adminLinks : vendorLinks;

  function logout() {
    localStorage.clear();
    router.push('/login');
  }

  return (
    <aside className="w-64 min-h-screen bg-[#1a1a2e] text-white flex flex-col">
      <div className="p-6 border-b border-white/10">
        <h1 className="text-xl font-bold">CanteenRush</h1>
        <p className="text-xs text-white/50 mt-1">{role === 'ADMIN' ? 'Admin Panel' : 'Vendor Dashboard'}</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {links.map((link) => (
          <Link
            key={link.href} href={link.href}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg transition text-sm ${
              pathname.startsWith(link.href)
                ? 'bg-[#e94560] text-white'
                : 'text-white/70 hover:bg-white/10'
            }`}
          >
            <span>{link.icon}</span>
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="p-4 border-t border-white/10">
        <button onClick={logout} className="w-full text-left px-4 py-2 text-sm text-white/50 hover:text-white transition">
          🚪 Logout
        </button>
      </div>
    </aside>
  );
}
