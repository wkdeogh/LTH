import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { FormSubmitFeedback } from '@/components/FormSubmitFeedback';
import './globals.css';

export const metadata: Metadata = {
  title: '쏙쓸계산기',
  description: '무한매수법 V4.0 개인용 주문 가이드 앱',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4f6f8',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <FormSubmitFeedback />
        <main className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-mark" aria-hidden="true">L</span>
              <span>쏙쓸계산기</span>
            </Link>
            <nav className="global-nav" aria-label="주요 메뉴">
              <Link href="/">전략</Link>
              <Link href="/rounds">기록</Link>
              <Link href="/guide">사용법</Link>
            </nav>
          </header>
          {children}
          <footer className="footer">
            <p>개인용 무한매수법 V4.0 주문 가이드</p>
            <Link href="/guide">전략 사용법</Link>
          </footer>
        </main>
      </body>
    </html>
  );
}
