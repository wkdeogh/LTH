'use client';

import { useEffect } from 'react';

function buttonLabel(button: HTMLButtonElement) {
  const text = button.textContent ?? '';
  if (text.includes('취소')) return '취소 중...';
  if (button.classList.contains('danger') || text.includes('삭제')) return '삭제 중...';
  if (text.includes('저장')) return '저장 중...';
  if (text.includes('전환')) return '전환 중...';
  if (text.includes('복귀')) return '복귀 중...';
  if (text.includes('갱신')) return '갱신 중...';
  return '처리 중...';
}

function restoreButton(button: HTMLButtonElement) {
  if (button.dataset.originalLabel) {
    button.innerHTML = button.dataset.originalLabel;
  }
  delete button.dataset.pending;
  delete button.dataset.originalLabel;
  button.disabled = false;
  button.removeAttribute('aria-busy');
  button.classList.remove('is-pending');
}

export function FormSubmitFeedback() {
  useEffect(() => {
    function onSubmit(event: Event) {
      const submitter = (event as SubmitEvent).submitter;
      if (!(submitter instanceof HTMLButtonElement)) return;

      if (submitter.classList.contains('danger')) {
        const message = submitter.dataset.confirm ?? '정말 이 전략을 삭제할까요? 삭제한 전략은 목록에서 숨겨집니다.';
        const ok = window.confirm(message);
        if (!ok) {
          event.preventDefault();
          return;
        }
      }

      if (submitter.dataset.pending === 'true') {
        event.preventDefault();
        return;
      }

      submitter.dataset.pending = 'true';
      submitter.dataset.originalLabel = submitter.innerHTML;
      submitter.disabled = true;
      submitter.setAttribute('aria-busy', 'true');
      submitter.classList.add('is-pending');
      submitter.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${buttonLabel(submitter)}</span>`;

      window.setTimeout(() => {
        if (document.body.contains(submitter) && submitter.dataset.pending === 'true') {
          restoreButton(submitter);
        }
      }, 15000);
    }

    document.addEventListener('submit', onSubmit, true);
    return () => document.removeEventListener('submit', onSubmit, true);
  }, []);

  return null;
}
