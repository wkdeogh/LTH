'use client';

import { useEffect, useRef } from 'react';
import { switchToNormal } from '@/app/actions';

export function AutoNormalTransition({ strategyId }: { strategyId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    formRef.current?.requestSubmit();
  }, []);

  return (
    <div style={{ marginTop: 12 }}>
      <p className="muted">최신 종가가 복귀 기준을 넘어 일반모드로 자동 전환하고 있습니다.</p>
      <form action={switchToNormal} ref={formRef}>
        <input name="id" type="hidden" value={strategyId} />
        <input name="automatic" type="hidden" value="1" />
        <button className="secondary" type="submit">바로 복귀</button>
      </form>
    </div>
  );
}
