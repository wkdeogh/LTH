'use client';

import { useEffect } from 'react';

type FormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const fieldNames: Record<string, string> = {
  name: '전략명',
  principal: '원금',
  cash_balance: '현금',
  position_qty: '보유수량',
  avg_price: '평단',
  t_value: 'T값',
  trade_date: '거래일',
  close_price: '종가',
  executed_at: '체결일',
  quantity: '수량',
  avg_execution_price: '평균 체결가',
  final_position_qty: '최종 보유수량',
  final_avg_price: '최종 평단',
  final_t_value: '최종 T값',
  started_at: '시작일',
  ended_at: '종료일',
  started_principal: '시작 원금',
  ending_cash_balance: '종료 현금',
  total_buy_amount: '매수 합계',
  total_sell_amount: '매도 합계',
  ending_t_value: '종료 T값',
};

let errorId = 0;

function formControls(form: HTMLFormElement) {
  return Array.from(form.elements).filter((element): element is FormControl => (
    element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement
  )).filter((element) => element.type !== 'hidden' && !element.disabled);
}

function namedControl(form: HTMLFormElement, name: string) {
  const element = form.elements.namedItem(name);
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement
    ? element
    : null;
}

function numericValue(control: FormControl | null) {
  if (!control || control.value.trim() === '') return null;
  const value = Number(control.value);
  return Number.isFinite(value) ? value : null;
}

function setBusinessError(control: FormControl | null, message: string) {
  if (!control) return;
  control.setCustomValidity(message);
  control.dataset.inlineCustom = 'true';
}

function clearBusinessErrors(form: HTMLFormElement) {
  for (const control of formControls(form)) {
    if (control.dataset.inlineCustom === 'true') {
      control.setCustomValidity('');
      delete control.dataset.inlineCustom;
    }
  }
}

function applyBusinessRules(form: HTMLFormElement) {
  const kind = form.dataset.validationKind;

  if (kind === 'strategy') {
    const position = numericValue(namedControl(form, 'position_qty')) ?? 0;
    const avgPrice = numericValue(namedControl(form, 'avg_price')) ?? 0;
    if (position > 0 && avgPrice <= 0) {
      setBusinessError(namedControl(form, 'avg_price'), '보유수량이 있으면 평단을 0보다 크게 입력해 주세요.');
    }
  }

  if (kind === 'execution') {
    const side = namedControl(form, 'side')?.value;
    const quantityControl = namedControl(form, 'quantity');
    const priceControl = namedControl(form, 'avg_execution_price');
    const quantity = numericValue(quantityControl) ?? 0;
    const price = numericValue(priceControl) ?? 0;
    const currentCash = Number(form.dataset.currentCash ?? 0);
    const currentPosition = Number(form.dataset.currentPosition ?? 0);

    if (side === 'sell' && quantity > currentPosition) {
      setBusinessError(quantityControl, `현재 보유수량 ${currentPosition}주보다 많이 매도할 수 없어요.`);
    }
    if (side === 'buy' && quantity > 0 && price > 0 && quantity * price > currentCash) {
      setBusinessError(priceControl, `매수금액이 현재 현금 $${currentCash.toLocaleString('en-US')}을 초과해요.`);
    }

    const useFinalState = namedControl(form, 'use_final_state');
    if (useFinalState instanceof HTMLInputElement && useFinalState.checked) {
      const finalPosition = numericValue(namedControl(form, 'final_position_qty'));
      const finalAvgControl = namedControl(form, 'final_avg_price');
      const finalAvg = numericValue(finalAvgControl);
      if (finalPosition !== null && finalPosition > 0 && finalAvg !== null && finalAvg <= 0) {
        setBusinessError(finalAvgControl, '최종 보유수량이 있으면 최종 평단을 0보다 크게 입력해 주세요.');
      }
    }
  }

  if (kind === 'round') {
    const startedAt = namedControl(form, 'started_at');
    const endedAt = namedControl(form, 'ended_at');
    if (startedAt?.value && endedAt?.value && startedAt.value > endedAt.value) {
      setBusinessError(endedAt, '종료일은 시작일과 같거나 이후여야 해요.');
    }
  }
}

function fieldLabel(control: FormControl) {
  return fieldNames[control.name] ?? '입력값';
}

function validationMessage(control: FormControl) {
  const label = fieldLabel(control);
  if (control.validity.customError) return control.validationMessage;
  if (control.validity.valueMissing) return `${label}: 값을 입력해 주세요.`;
  if (control.validity.rangeUnderflow) return `${label}: ${control.getAttribute('min')} 이상 입력해 주세요.`;
  if (control.validity.rangeOverflow) return `${label}: ${control.getAttribute('max')} 이하로 입력해 주세요.`;
  if (control.validity.stepMismatch || control.validity.badInput) return `${label}: 숫자 형식을 확인해 주세요.`;
  if (control.validity.typeMismatch) return `${label}: 입력 형식을 확인해 주세요.`;
  return control.validationMessage || `${label}: 값을 확인해 주세요.`;
}

function errorElement(control: FormControl) {
  const label = control.closest('label');
  if (!label) return null;

  let error = label.querySelector<HTMLElement>('.field-error');
  if (!error) {
    error = document.createElement('span');
    error.className = 'field-error';
    error.id = `field-error-${++errorId}`;
    error.setAttribute('aria-live', 'polite');
    label.append(error);
  }
  return error;
}

function showError(control: FormControl) {
  const error = errorElement(control);
  if (!error) return;
  error.textContent = validationMessage(control);
  control.setAttribute('aria-invalid', 'true');
  control.setAttribute('aria-describedby', error.id);
}

function clearError(control: FormControl) {
  const error = control.closest('label')?.querySelector<HTMLElement>('.field-error');
  if (error) error.textContent = '';
  control.removeAttribute('aria-invalid');
  control.removeAttribute('aria-describedby');
}

export function validateInlineForm(form: HTMLFormElement) {
  if (!form.matches('[data-inline-validation]')) return true;

  clearBusinessErrors(form);
  applyBusinessRules(form);
  const invalidControls = formControls(form).filter((control) => {
    if (control.checkValidity()) {
      clearError(control);
      return false;
    }
    showError(control);
    return true;
  });

  const firstInvalid = invalidControls[0];
  if (firstInvalid) {
    firstInvalid.focus({ preventScroll: true });
    firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return false;
  }
  return true;
}

export function InlineValidation() {
  useEffect(() => {
    const handleInvalid = (event: Event) => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return;
      if (!control.form?.matches('[data-inline-validation]')) return;
      event.preventDefault();
      showError(control);
    };

    const handleInput = (event: Event) => {
      const control = event.target;
      if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) return;
      const form = control.form;
      if (!form?.matches('[data-inline-validation]')) return;

      clearBusinessErrors(form);
      applyBusinessRules(form);
      for (const candidate of formControls(form)) {
        if (candidate.getAttribute('aria-invalid') !== 'true') continue;
        if (candidate.checkValidity()) clearError(candidate);
        else showError(candidate);
      }
    };

    document.addEventListener('invalid', handleInvalid, true);
    document.addEventListener('input', handleInput, true);
    document.addEventListener('change', handleInput, true);
    return () => {
      document.removeEventListener('invalid', handleInvalid, true);
      document.removeEventListener('input', handleInput, true);
      document.removeEventListener('change', handleInput, true);
    };
  }, []);

  return null;
}
