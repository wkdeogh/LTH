import Link from 'next/link';

type StrategyTabsProps = {
  strategyId: string;
  active: 'detail' | 'plan' | 'execution' | 'rounds';
};

export function StrategyTabs({ strategyId, active }: StrategyTabsProps) {
  const tabs = [
    { key: 'detail', label: '현재 상태', shortLabel: '상태', href: `/strategies/${strategyId}` },
    { key: 'plan', label: '주문 계산', shortLabel: '주문', href: `/strategies/${strategyId}/plan` },
    { key: 'execution', label: '체결 입력', shortLabel: '체결', href: `/strategies/${strategyId}/executions/new` },
    { key: 'rounds', label: '전략 기록', shortLabel: '기록', href: `/strategies/${strategyId}/rounds` },
  ] as const;

  return (
    <nav className="tabs" aria-label="전략 메뉴">
      {tabs.map((tab) => (
        <Link className={`tab ${active === tab.key ? 'active' : ''}`} href={tab.href} key={tab.key} aria-current={active === tab.key ? 'page' : undefined}>
          <span className="tab-full-label">{tab.label}</span>
          <span className="tab-short-label">{tab.shortLabel}</span>
        </Link>
      ))}
    </nav>
  );
}
