# 무한매수법 V4.0 원문 계산 웹앱 구현 계획

## 1. 방향

`Trade.md`는 사람이 읽고 실행하기 쉬운 간소화 메모로 유지합니다.

하지만 실제 웹앱의 계산 엔진은 원문 `무한매수법 V4.0`에 가깝게 구현합니다.

이렇게 분리하는 이유는 다음과 같습니다.

1. 사용자는 쉬운 화면과 간단한 입력만 사용한다.
2. 앱 내부는 `T값`, `별지점`, `일반모드`, `소진후 리버스모드`를 원문 방식으로 계산한다.
3. 사용자는 매일 복잡한 공식을 직접 계산하지 않아도 된다.
4. 전략별 상태가 DB에 저장되므로 다음 날 이어서 계산할 수 있다.
5. 실제 주문은 자동 실행하지 않고 사용자가 증권사 앱에서 직접 입력한다.

즉, 앱은 **오리지널 무한매수법 계산을 대신 해주는 개인용 주문 가이드 도구**입니다.

## 2. 앱 범위

### 포함

1. 로그인 없는 개인용 앱
2. 여러 전략 동시 관리
3. 전략 추가/수정/삭제
4. 전략별 현재 상태 저장
5. 일반모드 계산
6. 소진후 리버스모드 계산
7. 오늘 매수/매도 주문 가이드 생성
8. 체결 결과 입력
9. T값, 현금, 보유수량, 평단, 모드 갱신
10. 최근 종가 저장
11. 주문 가이드 및 체결 히스토리 저장

### 제외

1. 증권사 API 자동매매
2. 실시간 시세 자동조회
3. 로그인/회원가입
4. 다중 사용자 권한 관리
5. 세금 계산
6. 환율 자동 반영
7. 백테스트

## 3. 핵심 사용자 흐름

### 3.1 전략 목록

앱 첫 화면은 전략 목록입니다.

표시 항목은 다음입니다.

| 항목 | 설명 |
| --- | --- |
| 전략명 | 예: TQQQ 40분할 |
| 종목 | TQQQ 또는 SOXL |
| 분할 수 | 20 또는 40 |
| 모드 | 일반모드 또는 리버스모드 |
| T값 | 현재 진행 회차 |
| 원금 | 전략 기준 원금 |
| 현금 | 현재 주문 가능 현금 |
| 보유수량 | 현재 보유 주식 수 |
| 평단 | 증권사 기준 평균단가 |
| 오늘 계산 | 주문 가이드 생성 버튼 |

### 3.2 전략 추가

새 전략 생성 시 입력값입니다.

| 항목 | 예시 | 설명 |
| --- | --- | --- |
| 전략명 | TQQQ 40분할 | 사용자가 구분하기 쉬운 이름 |
| 종목 | TQQQ | TQQQ 또는 SOXL |
| 분할 수 | 40 | MVP는 20 또는 40만 지원 |
| 원금 | 20000 | 전략에 배정한 전체 달러 |
| 현금 | 20000 | 신규 시작이면 원금과 동일 |
| 보유수량 | 0 | 신규 시작이면 0 |
| 평단 | 0 | 신규 시작이면 0 |
| T값 | 0 | 신규 시작이면 0 |
| 모드 | 일반모드 | 신규 시작이면 일반모드 |

30분할은 원문에서 언급되지만, 별% 공식과 리버스 계산을 명확하게 관리하기 위해 MVP에서는 20/40분할만 지원합니다.

### 3.3 일일 입력

매일 주문 계산 전 사용자가 확인하거나 입력할 값입니다.

| 항목 | 설명 |
| --- | --- |
| 현재 현금 | 증권사 앱 기준 주문 가능 현금 |
| 현재 보유수량 | 증권사 앱 기준 수량 |
| 현재 평단 | 증권사 앱 기준 평단 |
| 현재 T값 | 앱 저장값을 기본 사용, 필요 시 수동 수정 |
| 전일 종가 또는 현재 참고가 | 첫 매수/큰수 주문 참고용 |
| 최근 5거래일 종가 | 리버스모드 기준가 계산용 |

앱은 저장된 상태를 기본으로 보여주고, 사용자가 증권사 기준값으로 덮어쓸 수 있게 합니다.

### 3.4 오늘 주문 계산

사용자가 `오늘 주문 계산` 버튼을 누르면 앱이 계산합니다.

일반모드에서는 다음을 보여줍니다.

1. 현재 구간: 첫 매수, 전반전, 후반전, 리버스 전환 대상
2. 오늘 1회 매수금
3. 별%
4. 별지점
5. LOC 매수 주문 가이드
6. LOC 쿼터매도 주문 가이드
7. 최종 지정가 매도 주문 가이드
8. 리버스모드 전환 여부

리버스모드에서는 다음을 보여줍니다.

1. 리버스모드 첫날 여부
2. 최근 5거래일 평균 종가
3. 오늘 매도 수량
4. 오늘 매수 가능 금액
5. 매수/매도 판단 기준
6. 일반모드 복귀 조건 만족 여부

### 3.5 체결 결과 입력

실제 주문 후 체결 결과를 입력합니다.

| 항목 | 설명 |
| --- | --- |
| 체결일 | 실제 체결 날짜 |
| 매수/매도 | buy 또는 sell |
| 주문 방식 | LOC, MOC, LIMIT, MANUAL |
| 수량 | 체결 주식 수 |
| 평균 체결가 | 체결 평균 가격 |
| T 반영 방식 | 1회 매수, 절반 매수, 쿼터매도, 지정가매도 등 |
| 메모 | 선택 입력 |

체결 결과 저장 시 앱은 예상 상태를 계산합니다.

하지만 최종 현금, 보유수량, 평단은 증권사 기준값으로 직접 입력할 수 있어야 합니다.

## 4. 원문 계산 로직

## 4.1 공통 상태

전략마다 다음 상태를 저장합니다.

1. 종목
2. 분할 수
3. 원금
4. 현금
5. 보유수량
6. 평단
7. T값
8. 모드
9. 리버스모드 첫날 처리 여부

## 4.2 일반모드 T값 계산

일반모드의 T값 반영입니다.

| 상황 | T값 계산 |
| --- | --- |
| 1회 매수 체결 | T + 1 |
| 절반 매수 체결 | T + 0.5 |
| 쿼터매도 체결 | 직전 T × 0.75 |
| 지정가매도 후 LOC 1회 매수 | 직전 T × 0.25 + 1 |
| 지정가매도 후 LOC 절반 매수 | 직전 T × 0.25 + 0.5 |

T값은 소수점 제한 없이 저장합니다.

## 4.3 일반모드 별%와 별지점

별% 공식입니다.

| 종목/분할 | 별% 공식 |
| --- | --- |
| 20분할 TQQQ | `(15 - 1.5T)%` |
| 40분할 TQQQ | `(15 - 0.75T)%` |
| 20분할 SOXL | `(20 - 2T)%` |
| 40분할 SOXL | `(20 - T)%` |

별지점 계산입니다.

```text
별지점 = 평단 × (1 + 별%)
매수점 = 별지점 - 0.01
매도점 = 별지점
```

## 4.4 일반모드 1회 매수금

매일 현재 잔금과 T값으로 다시 계산합니다.

```text
20분할 1회 매수금 = 현금 / (20 - T)
40분할 1회 매수금 = 현금 / (40 - T)
```

T값이 분할 수에 가까워져 `분할 수 - T <= 1`이면 일반모드 계산을 중단하고 리버스모드 전환 안내를 띄웁니다.

## 4.5 일반모드 구간 판단

| 분할 수 | 전반전 | 후반전 | 리버스모드 전환 |
| --- | --- | --- | --- |
| 20분할 | T < 10 | 10 <= T <= 19 | T > 19 |
| 40분할 | T < 20 | 20 <= T <= 39 | T > 39 |

## 4.6 일반모드 매수 계산

### 첫 매수

보유수량이 0이고 T값이 0이면 첫 매수입니다.

```text
초기 1회 매수금 = 원금 / 분할 수
```

앱은 현재가보다 10~15% 높은 참고 가격에 LOC 매수를 걸 수 있도록 안내합니다.

### 전반전 매수

전반전은 T가 분할 수의 절반 미만인 구간입니다.

```text
절반: 별지점 - 0.01 LOC 매수
절반: 평단 LOC 매수
추가: 더 낮은 가격대 LOC 매수는 사용자가 조정
```

앱은 각 가격별 예상 수량을 계산합니다.

```text
수량 = floor(배정 매수금 / 주문 가격)
```

### 후반전 매수

후반전은 T가 분할 수의 절반 이상인 구간입니다.

```text
전체 1회 매수금: 별지점 - 0.01 LOC 매수
추가: 더 낮은 가격대 LOC 매수는 사용자가 조정
```

## 4.7 일반모드 매도 계산

일반모드 매도는 전반전/후반전 공통입니다.

```text
쿼터매도 수량 = floor(보유수량 / 4)
쿼터매도 가격 = 별지점
```

최종 지정가 매도입니다.

| 종목 | 최종 지정가 매도 |
| --- | --- |
| TQQQ | 평단 × 1.15 |
| SOXL | 평단 × 1.20 |

```text
최종 지정가 매도 수량 = 보유수량 - 쿼터매도 수량
```

## 4.8 리버스모드 진입

다음 조건에서 리버스모드 전환 대상입니다.

| 분할 수 | 조건 |
| --- | --- |
| 20분할 | T > 19 |
| 40분할 | T > 39 |

전환 시 앱은 자동으로 모드를 바꾸기보다 확인 버튼을 보여줍니다.

확인하면 다음 값을 저장합니다.

```text
mode = reverse
reverse_started_at = 오늘 날짜
reverse_first_sell_done = false
```

## 4.9 리버스모드 첫날

리버스모드 첫날은 매수 없이 매도만 합니다.

| 분할 수 | 매도 수량 | 주문 방식 |
| --- | --- | --- |
| 20분할 | floor(보유수량 / 10) | MOC 매도 |
| 40분할 | floor(보유수량 / 20) | MOC 매도 |

첫날 매도 체결 입력 후 앱은 `reverse_first_sell_done = true`로 저장합니다.

## 4.10 리버스모드 둘째 날 이후

리버스모드의 기준가는 최근 5거래일 종가 평균입니다.

```text
리버스 기준가 = 최근 5거래일 종가 평균
```

이는 일반적인 5일 이동평균선과 같은 계산입니다.

매도 수량입니다.

```text
20분할 매도수량 = floor(직전 보유수량 / 10)
40분할 매도수량 = floor(직전 보유수량 / 20)
```

매수 금액입니다.

```text
리버스모드 매수금 = 현재 현금 × 0.25
매수수량 = floor(리버스모드 매수금 / 리버스 기준가)
```

T값 계산입니다.

```text
20분할 매도 후 T = 직전 T × 0.9
40분할 매도 후 T = 직전 T × 0.95

20분할 매수 후 T = 직전 T + (20 - 직전 T) × 0.25
40분할 매수 후 T = 직전 T + (40 - 직전 T) × 0.25
```

## 4.11 리버스모드 종료

종가가 평단 대비 일정 수준 이상 회복하면 일반모드 복귀 대상입니다.

| 종목 | 일반모드 복귀 조건 |
| --- | --- |
| TQQQ | 종가 > 평단 × 0.85 |
| SOXL | 종가 > 평단 × 0.80 |

복귀 시 다음처럼 저장합니다.

```text
mode = normal
reverse_started_at = null
reverse_first_sell_done = false
T값은 리버스모드에서 이어진 값을 그대로 사용
```

## 5. 데이터 모델

개인용 앱이므로 `users`, `profiles`, `auth`, `RLS`는 MVP에서 제외합니다.

## 5.1 strategies

전략 설정과 현재 상태를 저장합니다.

```sql
create table strategies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  symbol text not null check (symbol in ('TQQQ', 'SOXL')),
  split_count integer not null check (split_count in (20, 40)),
  principal numeric(18, 4) not null,
  cash_balance numeric(18, 4) not null,
  position_qty integer not null default 0,
  avg_price numeric(18, 4) not null default 0,
  t_value numeric(18, 10) not null default 0,
  mode text not null check (mode in ('normal', 'reverse')) default 'normal',
  reverse_started_at date,
  reverse_first_sell_done boolean not null default false,
  compounding_type text not null check (compounding_type in ('simple', 'compound')) default 'compound',
  is_archived boolean not null default false,
  sort_order integer not null default 0,
  started_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## 5.2 daily_prices

종가를 저장합니다.

```sql
create table daily_prices (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  trade_date date not null,
  close_price numeric(18, 4) not null,
  created_at timestamptz not null default now(),
  unique(strategy_id, trade_date)
);
```

## 5.3 trade_plans

매일 생성된 주문 가이드를 저장합니다.

```sql
create table trade_plans (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  plan_date date not null,
  mode text not null check (mode in ('normal', 'reverse')),
  phase text,
  t_value numeric(18, 10) not null,
  avg_price numeric(18, 4) not null,
  cash_balance numeric(18, 4) not null,
  position_qty integer not null,
  star_percent numeric(18, 8),
  star_price numeric(18, 4),
  one_unit_budget numeric(18, 4),
  reverse_reference_price numeric(18, 4),
  guidance jsonb not null,
  created_at timestamptz not null default now(),
  unique(strategy_id, plan_date)
);
```

## 5.4 executions

실제 체결 결과를 저장합니다.

```sql
create table executions (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  trade_plan_id uuid references trade_plans(id) on delete set null,
  executed_at date not null,
  side text not null check (side in ('buy', 'sell')),
  order_type text not null check (order_type in ('LOC', 'MOC', 'LIMIT', 'MANUAL')),
  quantity integer not null check (quantity > 0),
  avg_execution_price numeric(18, 4) not null,
  total_amount numeric(18, 4) not null,
  t_effect text check (t_effect in ('buy_full', 'buy_half', 'quarter_sell', 'limit_sell_then_full_buy', 'limit_sell_then_half_buy', 'reverse_buy', 'reverse_sell', 'none')),
  memo text,
  created_at timestamptz not null default now()
);
```

## 5.5 strategy_snapshots

전략 상태 변경 전후를 기록합니다.

```sql
create table strategy_snapshots (
  id uuid primary key default gen_random_uuid(),
  strategy_id uuid not null references strategies(id) on delete cascade,
  snapshot_date date not null,
  mode text not null,
  cash_balance numeric(18, 4) not null,
  position_qty integer not null,
  avg_price numeric(18, 4) not null,
  t_value numeric(18, 10) not null,
  note text,
  created_at timestamptz not null default now()
);
```

## 6. 기술 스택

권장 스택입니다.

```text
Next.js + TypeScript + Tailwind CSS + Supabase + Vercel
```

로그인은 만들지 않습니다.

대신 Supabase `service_role` 키를 브라우저에 노출하지 않기 위해 DB 접근은 Next.js 서버 코드에서만 수행합니다.

```text
Browser
=> Next.js UI
=> Next.js Server Actions or API Routes
=> Supabase Database
```

개인용이라도 외부 배포 시 보호가 필요합니다.

1. 로컬에서만 실행
2. Vercel Deployment Protection 사용
3. Cloudflare Access 사용
4. 추후 간단한 PIN 잠금 추가

## 7. 코드 구조

계산 로직은 UI와 분리합니다.

```text
src/lib/trading/types.ts
src/lib/trading/normalMode.ts
src/lib/trading/reverseMode.ts
src/lib/trading/mode.ts
src/lib/trading/tValue.ts
src/lib/trading/rounding.ts
src/lib/trading/validation.ts
```

핵심 함수입니다.

```ts
calculateOneUnitBudget(state)
calculateStarPercent(state)
calculateStarPrice(state)
detectNormalPhase(state)
calculateNormalPlan(state)
calculateReversePlan(state, recentCloses)
applyExecutionToState(state, execution)
shouldEnterReverseMode(state)
shouldReturnToNormalMode(state, closePrice)
```

타입 예시입니다.

```ts
type Symbol = 'TQQQ' | 'SOXL';
type SplitCount = 20 | 40;
type Mode = 'normal' | 'reverse';
type NormalPhase = 'initial' | 'first_half' | 'second_half' | 'reverse_required';

type StrategyState = {
  symbol: Symbol;
  splitCount: SplitCount;
  principal: number;
  cashBalance: number;
  positionQty: number;
  avgPrice: number;
  tValue: number;
  mode: Mode;
  reverseStartedAt?: string | null;
  reverseFirstSellDone: boolean;
};
```

## 8. 화면 설계

### 8.1 전략 목록

1. 전략 카드 목록
2. 전략 추가 버튼
3. 모드 표시
4. T값 표시
5. 오늘 계산 바로가기
6. 체결 입력 바로가기

### 8.2 전략 추가/수정

1. 전략명
2. 종목
3. 분할 수
4. 원금
5. 현금
6. 보유수량
7. 평단
8. T값
9. 모드

### 8.3 전략 상세

상단 카드 예시입니다.

```text
TQQQ 40분할
모드: 일반모드 / 전반전
T: 8.6
원금: 20,000
현금: 15,203.44
보유수량: 48
평단: 53.22
```

주요 버튼입니다.

1. 오늘 주문 계산
2. 체결 결과 입력
3. 현재 상태 수정
4. 종가 입력
5. 히스토리

### 8.4 오늘 주문 계산

가장 중요한 화면입니다.

일반모드에서는 다음 섹션을 보여줍니다.

1. 계산 기준값
2. 별%와 별지점
3. 1회 매수금
4. 오늘 매수 주문
5. 오늘 매도 주문
6. 모드 전환 경고
7. 계산 근거

리버스모드에서는 다음 섹션을 보여줍니다.

1. 첫날 여부
2. 최근 5일 평균
3. 오늘 매도 수량
4. 오늘 매수 가능 금액
5. T값 변화 예상
6. 일반모드 복귀 조건

항상 표시할 문구입니다.

```text
이 앱은 주문을 실행하지 않습니다.
실제 주문은 증권사 앱에서 직접 확인 후 입력하세요.
```

### 8.5 체결 결과 입력

체결 입력 후 저장 전 미리보기를 보여줍니다.

```text
저장 전
T: 8.6
현금: 15,203.44
보유수량: 48
평단: 53.22

저장 후 예상
T: 9.6
현금: 14,703.44
보유수량: 57
평단: 52.80
```

단, 최종 현금/보유수량/평단은 사용자가 증권사 기준값으로 수정할 수 있어야 합니다.

## 9. 구현 단계

### 1단계: 프로젝트 생성

1. Next.js + TypeScript 생성
2. Tailwind CSS 설정
3. Supabase 서버 클라이언트 설정
4. 환경변수 설정
5. 기본 라우팅 생성

라우트 예시입니다.

```text
/
/strategies/new
/strategies/[id]
/strategies/[id]/plan
/strategies/[id]/executions/new
```

### 2단계: DB 생성

1. Supabase 프로젝트 생성
2. 테이블 생성
3. 인덱스 추가
4. 샘플 전략 입력

### 3단계: 원문 계산 엔진 구현

1. T값 계산
2. 별% 계산
3. 별지점 계산
4. 1회 매수금 계산
5. 일반모드 주문 계산
6. 리버스모드 주문 계산
7. 모드 전환 판단
8. 체결 반영 계산

### 4단계: 전략 CRUD

1. 전략 목록
2. 전략 추가
3. 전략 수정
4. 전략 보관
5. 전략 삭제

### 5단계: 오늘 주문 계산

1. 전략 상태 불러오기
2. 필요 입력값 받기
3. 계산 함수 실행
4. 주문 가이드 표시
5. 계산 결과 저장

### 6단계: 체결 입력과 상태 갱신

1. 체결 내역 입력
2. T 반영 방식 선택
3. 예상 상태 계산
4. 증권사 기준 최종 상태 입력
5. 저장 전 미리보기
6. executions 저장
7. strategy_snapshots 저장
8. strategies 현재 상태 업데이트

### 7단계: 히스토리

1. 날짜별 주문 가이드 조회
2. 체결 내역 조회
3. 상태 변화 조회
4. 종가 기록 조회

## 10. 테스트 계획

단위 테스트 대상입니다.

1. 20분할 TQQQ 별% 계산
2. 40분할 TQQQ 별% 계산
3. 20분할 SOXL 별% 계산
4. 40분할 SOXL 별% 계산
5. 별지점 계산
6. 1회 매수금 계산
7. 전반전/후반전 판단
8. 쿼터매도 수량 계산
9. 최종 지정가 매도 계산
10. 일반모드 T값 갱신
11. 리버스모드 5일 평균 계산
12. 리버스모드 매수/매도 수량 계산
13. 리버스모드 T값 갱신
14. 일반모드 복귀 조건 계산

시나리오 테스트입니다.

1. TQQQ 40분할 신규 전략 생성
2. 첫 매수 가이드 생성
3. 1회 매수 체결 입력
4. 전반전 주문 가이드 생성
5. 쿼터매도 체결 입력
6. 후반전 진입
7. T > 39 상태에서 리버스모드 전환
8. 리버스모드 첫날 MOC 매도 가이드 생성
9. 리버스모드 둘째 날 이후 매수/매도 판단
10. 종가 회복 후 일반모드 복귀
11. 보유수량 0으로 사이클 종료

## 11. 중요한 UX 원칙

원문 계산은 복잡하므로 화면은 쉽게 보여줘야 합니다.

1. 사용자가 오늘 해야 할 주문을 가장 위에 보여준다.
2. 공식과 중간 계산값은 접을 수 있는 영역에 둔다.
3. `T값`, `별%`, `별지점`은 앱이 계산하고 사용자는 확인만 한다.
4. T값 수동 수정은 가능하게 둔다.
5. 모드 전환은 자동 저장하지 않고 확인을 받는다.
6. 체결 후 최종 상태는 증권사 기준값을 우선한다.
7. 주문 실행 앱이 아니라 주문 가이드 앱임을 명확히 표시한다.

## 12. 최종 정리

최종 구조는 다음입니다.

1. `Trade.md`: 사람이 이해하기 쉬운 간소화 설명서
2. `plan.md`: 앱 내부는 원문 무한매수법 V4.0에 가깝게 계산하는 구현 계획
3. 앱 사용 방식: 전략별 상태 저장 후 버튼으로 오늘 주문 계산
4. 실제 주문: 사용자가 증권사 앱에서 직접 실행
5. 체결 후: 결과 입력, 앱이 다음 날 계산 상태 저장

이 방식이면 사용자는 간단한 입력만 하면서도, 앱은 원문 방식의 복잡한 계산을 대신 수행할 수 있습니다.
