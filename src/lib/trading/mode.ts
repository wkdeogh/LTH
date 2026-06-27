import type { StrategyState } from '@/lib/types';

export function shouldEnterReverseMode(state: StrategyState) {
  return state.tValue > state.splitCount - 1;
}

export function modeLabel(mode: StrategyState['mode']) {
  return mode === 'normal' ? '일반모드' : '리버스모드';
}

export function phaseLabel(phase: string) {
  switch (phase) {
    case 'initial':
      return '첫 매수';
    case 'first_half':
      return '전반전';
    case 'second_half':
      return '후반전';
    case 'reverse_required':
      return '리버스 전환 대상';
    default:
      return phase;
  }
}
