import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'table-block — verification',
  description: 'n8n-like canvas for verifying the table-block model',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="h-full">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
