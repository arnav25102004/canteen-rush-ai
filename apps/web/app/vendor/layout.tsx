'use client';
import RoleGuard from '../../components/shared/RoleGuard';

const ALLOWED: ('VENDOR')[] = ['VENDOR'];

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return <RoleGuard allow={ALLOWED}>{children}</RoleGuard>;
}
