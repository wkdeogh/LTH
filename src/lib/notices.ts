export const noticeMessages = {
  'strategy-created': { message: '새 전략을 만들었어요.', tone: 'success' },
  'strategy-updated': { message: '현재 상태를 저장했어요.', tone: 'success' },
  'strategy-deleted': { message: '전략을 목록에서 정리했어요.', tone: 'success' },
  'price-saved': { message: '계산 기준가를 저장했어요.', tone: 'success' },
  'chart-refreshed': { message: 'SOXL 캔들을 최신 상태로 갱신했어요.', tone: 'success' },
  'reverse-started': { message: '리버스모드로 전환했어요.', tone: 'success' },
  'normal-restored': { message: '일반모드로 돌아왔어요.', tone: 'success' },
  'execution-saved': { message: '체결을 저장했어요.', tone: 'success' },
  'round-completed': { message: '이번 라운드 완료! 다음 라운드도 가보자고요.', tone: 'celebrate' },
  'execution-cancelled': { message: '최근 체결을 취소하고 이전 상태로 복원했어요.', tone: 'success' },
  'round-updated': { message: '라운드 기록을 수정했어요.', tone: 'success' },
  'round-deleted': { message: '라운드 기록을 삭제했어요.', tone: 'success' },
} as const;

export type NoticeKey = keyof typeof noticeMessages;

export function withNotice(path: string, notice: NoticeKey) {
  const url = new URL(path, 'https://local.invalid');
  url.searchParams.set('notice', notice);
  return `${url.pathname}${url.search}${url.hash}`;
}
