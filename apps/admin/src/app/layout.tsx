import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './admin.css';
import './signin.css';
import './portal.css';

const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700', '800'], variable: '--font-jakarta', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'DHA Works Admin', template: '%s | DHA Works Admin' },
  description: 'DHA Works staff portal',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
