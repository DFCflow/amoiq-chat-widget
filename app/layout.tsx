import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Amoiq Chat Widget',
  description: 'Customer chat widget',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

