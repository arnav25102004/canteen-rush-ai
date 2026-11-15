'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api from '../../lib/api';

type Role = 'ADMIN' | 'VENDOR';

function homeFor(role: string): string {
  if (role === 'ADMIN') return '/admin/dashboard';
  if (role === 'VENDOR') return '/vendor/dashboard';
  return '/login';
}

/** Client-side route guard. The role comes from GET /auth/me, never localStorage. */
export default function RoleGuard({ allow, children }: { allow: Role[]; children: React.ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/auth/me');
        if (cancelled) return;
        const user = data?.user as { role?: string; vendorCanteen?: { id?: string } | null } | undefined;
        if (!user?.role) { router.replace('/login'); return; }
        localStorage.setItem('user_role', user.role);
        if (user.vendorCanteen?.id) localStorage.setItem('canteen_id', user.vendorCanteen.id);
        else localStorage.removeItem('canteen_id');
        if ((allow as string[]).includes(user.role)) setOk(true);
        else router.replace(homeFor(user.role));
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [allow, router]);

  if (!ok) return <div className="flex items-center justify-center h-screen text-gray-500">Loading...</div>;
  return <>{children}</>;
}
