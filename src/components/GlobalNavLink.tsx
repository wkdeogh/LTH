'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function GlobalNavLink({ href, section, children }: {
  href: string;
  section: 'strategies' | 'records' | 'guide';
  children: ReactNode;
}) {
  const pathname = usePathname();
  const currentSection = pathname === '/guide'
    ? 'guide'
    : pathname === '/rounds' || /^\/strategies\/[^/]+\/rounds$/.test(pathname)
      ? 'records'
      : pathname === '/' || pathname.startsWith('/strategies/')
        ? 'strategies'
        : null;

  return <Link href={href} aria-current={section === currentSection ? (pathname === href ? 'page' : 'location') : undefined}>{children}</Link>;
}
