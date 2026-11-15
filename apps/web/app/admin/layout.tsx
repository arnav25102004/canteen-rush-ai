'use client';
import RoleGuard from '../../components/shared/RoleGuard';

const ALLOWED: ('ADMIN')[] = ['ADMIN'];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard allow={ALLOWED}>{children}</RoleGuard>;
}
