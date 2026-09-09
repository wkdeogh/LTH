import { useLayoutEffect, useRef } from 'react';

export function useRetainedForm(feedback: { error: string | null }) {
  const ref = useRef<HTMLFormElement>(null);
  const saved = useRef<FormData | null>(null);
  useLayoutEffect(() => {
    if (!feedback.error || !saved.current || !ref.current) return;
    for (const field of Array.from(ref.current.elements)) {
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) || !field.name || field.type === 'hidden') continue;
      if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) field.checked = saved.current.getAll(field.name).includes(field.value);
      else field.value = String(saved.current.get(field.name) ?? '');
    }
  }, [feedback]);
  return { ref, onSubmit: () => { if (ref.current) saved.current = new FormData(ref.current); } };
}
