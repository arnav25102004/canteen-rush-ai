import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Christ Canteen — Vendor Dashboard',
  description: 'Vendor & Admin dashboard for Christ University Virtual Canteen System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
