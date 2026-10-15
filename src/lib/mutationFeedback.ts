export type MutationFeedback = { error: string | null };

export function mutationErrorMessage(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
  const messages: Record<string, string> = {
    CASH_FLOW_DATE_ORDER: '최근 체결·보정·입출금 이후부터 오늘까지의 날짜를 선택해 주세요.',
    INSUFFICIENT_CASH: '인출 금액이 반영 후 현금을 초과합니다. 입출금 금액이나 예약을 확인해 주세요.',
    INVALID_PRINCIPAL: '입출금과 예약을 반영한 원금은 0보다 커야 합니다.',
    CASH_FLOW_NOT_PENDING: '이미 반영되거나 취소된 예약입니다. 새로고침해 주세요.',
    MISSING_REFERENCE_PRICE: 'T값을 계산하려면 최근 종가를 먼저 입력해 주세요.',
    STALE_STRATEGY: '다른 화면에서 전략이 변경되었습니다. 새로고침 후 다시 입력해 주세요.',
    REQUEST_CONFLICT: '이미 사용한 저장 요청입니다. 새로고침 후 다시 입력해 주세요.',
    REQUEST_CANCELLED: '취소한 체결 요청입니다. 새로고침 후 다시 입력해 주세요.',
    EXECUTION_DATE_ORDER: '최근 체결·상태 보정·입출금보다 이전 날짜는 저장할 수 없습니다.',
    INVALID_EXECUTION_DATE: '체결일을 확인해 주세요.',
    CORRECTION_DATE_ORDER: '최근 체결·보정일 이후부터 오늘까지의 날짜를 선택해 주세요.',
    SYMBOL_HAS_HISTORY: '체결 기록이 있는 전략의 종목은 변경할 수 없습니다.',
    STRATEGY_NOT_ACTIVE: '사용 중인 전략을 찾을 수 없습니다.',
  };
  return messages[message] ?? (/[가-힣]/.test(message) ? message : '저장하지 못했습니다. 입력값을 유지한 채 다시 시도해 주세요.');
}
