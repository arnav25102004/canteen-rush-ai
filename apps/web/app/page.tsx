'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const role = localStorage.getItem('user_role');
    if (!token) { router.push('/login'); return; }
    if (role === 'ADMIN') router.push('/admin/dashboard');
    else router.push('/vendor/dashboard');
  }, [router]);
  return <div className="flex items-center justify-center h-screen text-gray-500">Redirecting...</div>;
}
