export type NotificationItem = { id: string; strategy_id: string | null; event_key?: string; title: string; body: string; tone: string; read_at: string | null; created_at: string };
export function notificationTime(value: string, seconds = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '시간 정보 없음';
  const parts = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}${seconds ? `:${p.second}` : ''}`;
}
export function notificationMeaning(item: NotificationItem) {
  if (item.body.includes('장운영 상태')) return {
    type: '자동주문 확인', meaning: '장운영 상태를 확인하는 단계에서 작업이 중단됐을 때 남긴 기록입니다. 주문 접수 여부를 알려주는 증권사 거절 메시지와는 구분됩니다.',
    next: '주문 탭과 메리츠 주문내역에서 접수 여부를 확인할 수 있습니다. 과거 알림을 열어도 주문을 다시 보내지는 않습니다.',
  };
  if (item.body.includes('수동 주문의 가격·수량이 가이드')) return {
    type: '체결 확인 대기', meaning: '메리츠 체결을 당시 주문 가이드와 연결하지 못해 자동 입력을 보류했다는 뜻입니다. 수량이나 T값을 추정해서 바꾸지 않았습니다.',
    next: '이미 직접 입력했다면 같은 체결을 또 입력할 필요가 없습니다. 수량·금액이 일치하면 대조 후 확인 대기가 해제됩니다.',
  };
  if (item.title.includes('수동 체결 입력 확인')) return { type: '수동 입력 대조 완료', meaning: '직접 입력한 체결과 증권사 체결의 수량·금액이 일치해 확인 대기를 해제했습니다.', next: '앱의 수량·현금·평단·T값을 다시 변경하거나 체결을 추가 등록하지 않았습니다.' };
  if (item.title.includes('재주문')) return { type: '새벽 3시 재점검', meaning: '1차 기준가와 새벽 3시 현재가를 비교해 취소·재주문을 처리한 결과입니다. 취소 또는 새 주문이 확인되지 않은 경우에는 경고로 기록됩니다.', next: item.tone === 'success' ? '주문 접수 결과입니다. 실제 체결은 장 마감 뒤 조회합니다.' : '아래 처리 내용을 확인하고 주문 탭과 메리츠 주문내역을 대조해 주세요.' };
  if (item.title.includes('체결')) return { type: '체결 조회·반영', meaning: '장 마감 이후 조회한 실제 체결을 앱 기록과 대조한 결과입니다.', next: item.tone === 'warning' ? '아래 원인을 확인해 주세요. 확인이 필요한 내역은 중복 입력하거나 임의로 덮어쓰지 않습니다.' : '체결 탭에서 반영된 내역을 확인할 수 있습니다.' };
  return { type: item.tone === 'warning' ? '주문 확인 필요' : '주문 처리 결과', meaning: item.tone === 'warning' ? '주문 처리 중 확인이 필요한 상황이 발생해 남긴 기록입니다.' : '주문을 증권사에 접수한 결과입니다. 접수 완료와 실제 체결은 구분됩니다.', next: '아래 내용은 이 알림이 발생한 당시의 기록입니다. 최신 접수·체결 상태는 주문 탭과 메리츠 주문내역에서 확인해 주세요.' };
}
