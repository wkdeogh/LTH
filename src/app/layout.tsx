import { hasAppAccess } from '@/lib/access/server';
import { PageTransition } from '@/components/PageTransition';
import { MainRecordsLink } from '@/components/MainRecordsLink';
import { GlobalNavLink } from '@/components/GlobalNavLink';
import { Suspense } from 'react';
import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { FormSubmitFeedback } from '@/components/FormSubmitFeedback';
import { InlineValidation } from '@/components/InlineValidation';
import { PullToRefresh } from '@/components/PullToRefresh';
import { Toast } from '@/components/Toast';
import { TouchFeedback } from '@/components/TouchFeedback';
import soxlLogo from './icon.png';
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const access = await hasAppAccess();
  return (
    <html lang="ko">
      <body>
        <InlineValidation />
        <FormSubmitFeedback />
        <TouchFeedback />
        {access && <PullToRefresh />}
        <Suspense fallback={null}><Toast /></Suspense>
        <main className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <Image className="brand-mark" src={soxlLogo} alt="" priority />
              <span>쏙쓸계산기</span>
            </Link>
            {access && <nav className="global-nav" aria-label="주요 메뉴">
              <GlobalNavLink href="/" section="strategies">전략</GlobalNavLink>
              <Suspense fallback={<GlobalNavLink href="/rounds" section="records">기록</GlobalNavLink>}><MainRecordsLink /></Suspense>
              <GlobalNavLink href="/guide" section="guide">사용법</GlobalNavLink>
            </nav>}
          </header>
          <Suspense fallback={children}><PageTransition>{children}</PageTransition></Suspense>
          {access && <footer className="footer">
            <p>개인용 무한매수법 V4.0 주문 가이드</p>
            <Link href="/guide">전략 사용법</Link>
          </footer>}
        </main>
      </body>
    </html>
  );
}
