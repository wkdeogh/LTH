import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '무매 계산 도우미',
  description: '무한매수법 V4.0 개인용 주문 가이드 앱',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <main className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              무매 계산 도우미
            </Link>
            <nav className="nav">
              <Link href="/">전략 목록</Link>
              <Link href="/strategies/new">전략 추가</Link>
            </nav>
          </header>
          {children}
        </main>
      </body>
    </html>
  );
}
