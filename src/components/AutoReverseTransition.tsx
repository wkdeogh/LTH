'use client';

import { useEffect, useRef } from 'react';
import { switchToReverse } from '@/app/actions';

export function AutoReverseTransition({ strategyId }: { strategyId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    formRef.current?.requestSubmit();
  }, []);

  return (
    <section className="panel">
      <h2>리버스모드로 자동 전환 중</h2>
      <p className="muted">T값이 기준을 넘어 상태를 전환하고 첫날 매도 가이드를 계산하고 있습니다.</p>
      <form action={switchToReverse} ref={formRef}>
        <input name="id" type="hidden" value={strategyId} />
        <input name="automatic" type="hidden" value="1" />
        <button className="secondary" type="submit">바로 전환</button>
      </form>
    </section>
  );
}
