import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '쏙쓸계산기',
  description: '무한매수법 V4.0 개인용 주문 가이드 앱',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <main className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-mark">📈</span>
              <span>쏙쓸계산기</span>
            </Link>
            <Link className="home-button" href="/" aria-label="전략 목록으로 이동" title="전략 목록">
              🏠
            </Link>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
