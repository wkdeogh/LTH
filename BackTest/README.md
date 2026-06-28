# BackTest

TQQQ/SOXL 전용 백테스트 초안입니다. 앱 코드와 분리된 Node CLI로 시작하며, 외부 패키지 없이 실행합니다.

## 1. 가격 데이터 다운로드

Yahoo Finance 일봉 데이터를 split-adjusted OHLC CSV로 저장합니다.

```bash
npm run backtest:download -- TQQQ 2010-01-01 2026-06-28
npm run backtest:download -- SOXL 2010-01-01 2026-06-28
```

저장 위치:

```text
BackTest/data/TQQQ.csv
BackTest/data/SOXL.csv
```

가격 CSV는 커밋하지 않습니다.

## 2. 백테스트 실행

```bash
npm run backtest:run -- TQQQ 40 20000 2020-01-01 2024-12-31
npm run backtest:run -- SOXL 20 20000 2020-01-01 2024-12-31 --simple
```

인자:

```text
symbol splitCount principal startDate endDate [--compound|--simple] [--csv path]
```

기본은 복리입니다.

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
