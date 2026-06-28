# BackTest

TQQQ/SOXL 전용 백테스트입니다. 가장 편한 방법은 파이썬 CLI 하나로 다운로드와 실행을 한 번에 하는 것입니다.

## 가장 쉬운 사용법

```bash
python3 BackTest/backtest.py all TQQQ 40 20000 2020-01-01 2024-12-31
```

이 명령은 다음을 한 번에 합니다.

1. Yahoo Finance에서 TQQQ 일봉을 다운로드합니다.
2. `BackTest/data/TQQQ.csv`에 저장합니다.
3. 40분할, 원금 20,000달러, 2020-01-01부터 2024-12-31까지 백테스트를 실행합니다.

npm으로 실행하고 싶으면 같은 명령을 이렇게 써도 됩니다.

```bash
npm run backtest:py -- all TQQQ 40 20000 2020-01-01 2024-12-31
```

## 자주 쓸 명령

TQQQ 40분할 복리:

```bash
python3 BackTest/backtest.py all TQQQ 40 20000 2020-01-01 2024-12-31
```

SOXL 20분할 복리:

```bash
python3 BackTest/backtest.py all SOXL 20 20000 2020-01-01 2024-12-31
```

단리로 실행:

```bash
python3 BackTest/backtest.py all SOXL 20 20000 2020-01-01 2024-12-31 --simple
```

결과 전체를 JSON으로 저장:

```bash
python3 BackTest/backtest.py all TQQQ 40 20000 2020-01-01 2024-12-31 --json-out BackTest/results/tqqq-40.json
```

## 다운로드와 실행을 따로 하기

가격 데이터만 다운로드:

```bash
python3 BackTest/backtest.py download TQQQ 2010-01-01 2026-06-28
```

이미 받은 CSV로 백테스트:

```bash
python3 BackTest/backtest.py run TQQQ 40 20000 2020-01-01 2024-12-31
```

다른 CSV 파일 사용:

```bash
python3 BackTest/backtest.py run TQQQ 40 20000 2020-01-01 2024-12-31 --csv BackTest/fixtures/sample-TQQQ.csv
```

기본 CSV 저장 위치:

```text
BackTest/data/TQQQ.csv
BackTest/data/SOXL.csv
```

가격 CSV는 커밋하지 않습니다.

## 현재 구현 범위

- 지원 종목: `TQQQ`, `SOXL`
- 지원 분할: `20`, `40`
- 첫 거래일 종가로 1회분을 매수하고 시작
- 일반모드 별지점/쿼터매도/최종매도 계산
- 리버스모드 자동 진입과 단순 체결 가정
- 라운드별 수익률, 체결 내역, MDD 출력

## 중요한 체결 가정

- LOC 매수/매도: 당일 `low <= orderPrice <= high`이면 주문가 체결
- LIMIT 매도: 당일 `high >= limitPrice`이면 지정가 체결
- MOC 매도: 당일 종가 체결
- 같은 날 매도와 매수가 모두 가능하면 매도를 먼저 반영

이 가정은 실제 LOC 체결과 다를 수 있습니다.

## 예전 Node CLI

Node 버전도 남겨두었습니다.

```bash
npm run backtest:download -- TQQQ 2010-01-01 2026-06-28
npm run backtest:run -- TQQQ 40 20000 2020-01-01 2024-12-31
```

앞으로는 파이썬 CLI를 우선 사용하면 됩니다.
