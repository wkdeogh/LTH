# 백테스트 구현 계획

## 목표

- 현재 앱의 무한매수법 V4 계산 로직이 과거 일봉 데이터에서 어떻게 동작했는지 검증한다.
- 결과는 라운드별 수익률, 누적 수익률, 최대 낙폭, 현금 소진/리버스모드 기간, 체결 내역으로 확인한다.
- 실제 주문 자동화가 아니라 전략 검증용 도구로만 사용한다.

## 데이터 소스

### 1순위: Yahoo Finance 일봉 데이터

- 대상: `TQQQ`, `SOXL`.
- 장점: 무료로 긴 기간의 일봉 데이터를 구하기 쉽고, 액면분할 조정 데이터가 포함된다.
- 사용 방식: 개발 단계에서는 `yfinance` 또는 Yahoo Chart API로 다운로드한 CSV를 저장해서 사용한다.
- 필요한 컬럼: `date`, `open`, `high`, `low`, `close`, `adj_close`, `volume`.
- 백테스트 가격은 액면분할을 반영한 adjusted OHLC가 필요하다. `yfinance`를 쓰면 `auto_adjust=True`로 OHLC를 조정한 값으로 저장한다.
- 무료 API는 안정성이 보장되지 않으므로 앱 런타임에서 매번 직접 호출하지 말고, 먼저 CSV로 내려받아 `data/prices/*.csv`처럼 고정 입력으로 둔다.

### 2순위: Stooq CSV

- 대상: `TQQQ.US`, `SOXL.US`.
- 장점: 로그인 없이 CSV 다운로드가 단순하다.
- 단점: 조정 방식과 ETF 분할 반영 여부를 샘플 구간에서 반드시 확인해야 한다.
- 사용 조건: Yahoo 데이터와 같은 날짜의 종가가 크게 다른 구간, 특히 분할일 전후를 비교한 뒤 채택한다.

### 3순위: 유료/안정 API

- 후보: Polygon, Tiingo, Nasdaq Data Link.
- 장점: API 안정성, 조정 가격 옵션, 대량 다운로드 관리가 좋다.
- 단점: 키와 비용이 필요하다.
- 개인용 MVP에서는 불필요하고, Yahoo/Stooq 데이터 품질이 부족할 때만 검토한다.

## RAM 데이터 처리

- 앱 계산에서 `RAM`은 `SOXL`과 같은 20% 기준을 쓴다.
- 하지만 백테스트 가격 데이터는 계산식과 별개다. `RAM`이 실제 거래 티커라면 별도 가격 CSV가 필요하다.
- `RAM`의 공개 일봉 데이터 출처가 불명확하면 백테스트 MVP에서는 `RAM`을 직접 지원하지 않는다.
- 대안으로 `RAM` 전략을 `SOXL` 가격 데이터에 매핑하는 옵션을 둘 수 있지만, 결과 화면에 `RAM 계산식 + SOXL 가격 데이터 사용`이라고 명확히 표시해야 한다.

## 가격 데이터 저장 형식

```text
data/prices/TQQQ.csv
data/prices/SOXL.csv
```

CSV 컬럼:

```text
date,open,high,low,close,adj_close,volume
2024-06-27,73.12,74.40,72.80,73.95,73.95,123456789
```

규칙:

- 날짜는 미국 장 기준 `YYYY-MM-DD`.
- 가격은 split-adjusted 값이어야 한다.
- 누락 거래일은 채우지 않는다. 실제 거래일 행만 사용한다.
- 백테스트 로딩 시 날짜 오름차순으로 정렬한다.
- 중복 날짜가 있으면 실패 처리한다.

## 체결 가정

실제 LOC/MOC 체결 여부를 완벽히 재현할 수 없으므로 MVP에서는 보수적인 규칙을 고정한다.

### LOC 매수

- 주문 가격이 당일 `low <= orderPrice <= high` 범위에 들어오면 체결된 것으로 본다.
- 체결가는 주문 가격으로 기록한다.
- 범위에 들어오지 않으면 미체결로 본다.

### LOC 매도

- 주문 가격이 당일 `low <= orderPrice <= high` 범위에 들어오면 체결된 것으로 본다.
- 체결가는 주문 가격으로 기록한다.
- 범위에 들어오지 않으면 미체결로 본다.

### LIMIT 매도

- 당일 `high >= limitPrice`이면 체결된 것으로 본다.
- 체결가는 limitPrice로 기록한다.

### MOC 매도

- 당일 종가 `close`에 체결된 것으로 본다.

### MANUAL 리버스 매수/매도

- 리버스모드는 현재 앱이 `referencePrice` 기준 주문 가이드를 제공하므로, MVP에서는 다음처럼 단순화한다.
- 매수 조건: 당일 종가가 5일 평균보다 낮으면 종가에 매수.
- 매도 조건: 당일 종가가 5일 평균보다 높으면 종가에 매도.
- 이 가정은 실제 앱의 수동 판단과 다를 수 있으므로 결과 화면에 별도 표시한다.

## 초기 상태 가정

- 백테스트는 사용자가 이미 첫 매수를 하고 전략을 시작한다는 현재 사용 흐름에 맞춘다.
- 시작일 첫 거래일 종가로 `원금 / 분할 수`만큼 매수한 상태를 만든다.
- 초기 상태:
  - `cash_balance = principal - 첫 매수 금액`
  - `position_qty = floor((principal / split_count) / startClose)`
  - `avg_price = startClose`
  - `t_value = 1`
  - `mode = normal`
- 첫 매수 수량이 0이면 백테스트를 시작하지 않고 입력 원금 부족으로 실패 처리한다.

## 시뮬레이션 흐름

1. CSV 가격 데이터를 로드한다.
2. 선택한 시작일/종료일 사이 거래일만 남긴다.
3. 첫 거래일 종가로 초기 매수를 만든다.
4. 다음 거래일부터 매일 반복한다.
5. 현재 `StrategyState`로 `calculateNormalPlan` 또는 `calculateReversePlan`을 호출한다.
6. 생성된 주문 가이드를 당일 OHLC 체결 가정에 맞춰 평가한다.
7. 체결된 주문만 상태에 반영한다.
8. T값은 현재 `applyTEffect` 규칙을 사용한다.
9. 매도 후 보유수량이 0이면 라운드를 종료하고 `completed_rounds`와 같은 구조의 결과를 만든다.
10. 라운드 종료 후 복리/단리 설정에 따라 새 라운드 상태를 초기화한다.
11. 종료일까지 반복한다.

## 상태 반영 규칙

### 매수 체결

- `cash_balance -= quantity * price`
- `position_qty += quantity`
- `avg_price = 총 매입 원가 / position_qty`
- `t_value = applyTEffect(previousT, buy_full 또는 buy_half, splitCount)`

### 매도 체결

- `cash_balance += quantity * price`
- `position_qty -= quantity`
- `avg_price`는 남은 수량이 있으면 유지한다.
- 남은 수량이 0이면 `avg_price = 0`, `t_value = 0`, `mode = normal`로 새 라운드를 시작한다.
- T값은 주문 종류에 따라 `quarter_sell`, `limit_sell_then_*`, `reverse_sell`을 적용한다.

### 여러 주문이 같은 날 체결될 때

- 안전한 MVP 순서:
  1. 매도 주문 먼저 반영
  2. 매수 주문 반영
- 이유: 같은 날 수익 실현 후 현금으로 매수하는 상황을 더 보수적으로 처리하기 위함이다.
- 향후 옵션으로 `buy-first`, `sell-first`, `best-case`, `worst-case`를 비교할 수 있다.

## 결과 지표

필수:

- 시작 원금
- 종료 평가액: `cash_balance + position_qty * 마지막 종가`
- 총 수익금
- 총 수익률
- 라운드별 수익금/수익률
- 라운드별 시작일/종료일/기간
- 총 체결 수
- 매수 횟수, 매도 횟수
- 리버스모드 진입 횟수와 총 리버스모드 거래일 수
- 최대 낙폭 MDD

추가:

- 연환산 수익률 CAGR
- 승리 라운드 비율
- 평균 라운드 기간
- 최대 라운드 손실
- 현금 최저점
- T값 최대치

## UI 구성

### 백테스트 입력 페이지

경로 후보: `/backtests/new` 또는 `/strategies/[id]/backtest`.

입력값:

- 종목: `TQQQ`, `SOXL`, `RAM`
- RAM 선택 시 가격 데이터 매핑 안내 필요
- 분할 수: `20`, `40`
- 원금
- 시작일
- 종료일
- 복리/단리
- 가격 데이터 파일 선택 또는 서버에 저장된 CSV 선택

### 결과 페이지

상단 요약:

- 총 수익률
- 총 수익금
- 종료 평가액
- MDD
- 완료 라운드 수
- 리버스모드 일수

라운드 표:

- 라운드 번호
- 기간
- 시작 원금
- 종료 현금/평가액
- 수익금
- 수익률
- 체결 수

체결 내역:

- 날짜
- 매수/매도
- 주문 방식
- 가격
- 수량
- 금액
- T 반영
- 체결 가정 메모

## 구현 위치

권장 파일:

```text
src/lib/backtest/loadPrices.ts
src/lib/backtest/simulate.ts
src/lib/backtest/types.ts
src/app/backtests/new/page.tsx
src/app/backtests/results/page.tsx
```

계산 재사용:

- 기존 `src/lib/trading/*` 함수를 그대로 사용한다.
- 백테스트 전용 계산식을 새로 만들지 않는다.
- 체결 판정과 상태 업데이트만 `src/lib/backtest/*`에 둔다.

## 데이터 다운로드 스크립트

MVP에서는 앱 안에서 외부 API를 호출하지 말고 스크립트로 CSV를 만든다.

후보:

```text
scripts/download-prices.ts
```

명령 예시:

```bash
npm run prices -- TQQQ 2010-01-01 2026-12-31
npm run prices -- SOXL 2010-01-01 2026-12-31
```

Node만으로 Yahoo Chart API를 호출하거나, 별도 Python 스크립트에서 `yfinance`를 사용한다.
현재 repo는 npm 기반이므로 앱 코드와 통합하려면 Node 스크립트가 더 단순하다.

## Yahoo Chart API 예시

```text
https://query1.finance.yahoo.com/v8/finance/chart/TQQQ?period1=1262304000&period2=1798675200&interval=1d&events=history%7Csplit%7Cdiv
```

주의:

- `period1`, `period2`는 Unix timestamp 초 단위다.
- 응답의 `adjclose`와 split 이벤트를 확인한다.
- OHLC를 직접 조정하려면 `adj_close / close` 비율을 각 날짜의 `open/high/low/close`에 곱한다.
- `close`가 0이거나 누락된 날짜는 제거한다.

## 검증 방법

1. 10거래일짜리 작은 CSV fixture를 손으로 만든다.
2. 첫 매수, 전반전 매수, 후반전 매수, 쿼터매도, 최종매도, 리버스모드 진입을 각각 강제로 발생시키는 fixture를 만든다.
3. 각 fixture에서 체결 수량, 현금, 보유수량, T값이 예상과 같은지 확인한다.
4. 실제 TQQQ 1년 구간으로 smoke test를 돌려 결과가 음수/NaN 없이 생성되는지 확인한다.
5. 같은 입력을 두 번 실행했을 때 결과가 완전히 동일해야 한다.

## 주요 리스크

- LOC 주문은 실제 체결 규칙이 복잡해서 OHLC만으로 정확히 재현할 수 없다.
- 무료 데이터는 분할/배당 조정 방식이 바뀔 수 있다.
- SOXL/TQQQ 같은 레버리지 ETF는 장기 데이터에서 분할이 많아 조정 가격 검증이 중요하다.
- 리버스모드의 수동 판단은 앱 사용자의 실제 행동과 달라질 수 있다.
- 세금, 수수료, 슬리피지는 MVP에서 제외하면 실제 수익보다 낙관적으로 나온다.

## MVP 범위

먼저 구현할 것:

1. Yahoo CSV 다운로드 스크립트
2. CSV 로더와 데이터 검증
3. TQQQ/SOXL 단일 전략 백테스트
4. 완료 라운드 요약과 체결 내역 출력
5. 수수료/세금/슬리피지 없는 결과

나중에 구현할 것:

1. RAM 실제 데이터 연결 또는 명시적 SOXL 데이터 매핑
2. 수수료/슬리피지 옵션
3. 여러 체결 순서 시나리오 비교
4. 결과를 DB에 저장
5. 차트와 CSV 내보내기
