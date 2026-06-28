import Link from 'next/link';

type StrategyTabsProps = {
  strategyId: string;
  active: 'detail' | 'plan' | 'execution' | 'rounds';
};

export function StrategyTabs({ strategyId, active }: StrategyTabsProps) {
  const tabs = [
    { key: 'detail', label: '상세', href: `/strategies/${strategyId}` },
    { key: 'plan', label: '주문 계산', href: `/strategies/${strategyId}/plan` },
    { key: 'execution', label: '체결 입력', href: `/strategies/${strategyId}/executions/new` },
    { key: 'rounds', label: '전략 기록', href: `/strategies/${strategyId}/rounds` },
  ] as const;

  return (
    <nav className="tabs" aria-label="전략 메뉴">
      {tabs.map((tab) => (
        <Link className={`tab ${active === tab.key ? 'active' : ''}`} href={tab.href} key={tab.key}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
