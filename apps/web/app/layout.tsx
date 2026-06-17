import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CanteenRush — Vendor Dashboard',
  description: 'Vendor & Admin dashboard for CanteenRush Smart Campus Canteen Platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
