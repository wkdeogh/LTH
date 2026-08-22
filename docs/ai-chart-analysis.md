# AI 차트 분석: 이론, 한계, 구현 명세

## 1. 기능의 성격

이 기능은 TQQQ/SOXL의 과거 일봉 OHLCV만으로 다음 5개 거래일의 흐름과 종가를 추정하는 **오락·참고용 기술적 분석**이다. 가격을 확정적으로 예언하거나 주문을 자동화하지 않는다. 뉴스, 실적, 금리, 옵션 포지셔닝, 장중 데이터가 입력에 없으므로 결과는 조건부 시나리오이며 투자 조언이 아니다.

## 2. 조사에서 채택한 원칙

1. **패턴은 정량화한다.** Lo, Mamaysky, Wang은 주관적인 차트 패턴을 비모수 커널 회귀로 체계화했으며 일부 패턴이 조건부 수익률 분포에 추가 정보를 줄 수 있음을 보였다. 따라서 모델에는 차트 그림이 아니라 날짜별 수치와 결정론적으로 계산한 지표를 함께 전달한다.
2. **한 지표를 단독 신호로 쓰지 않는다.** 추세, 모멘텀, 변동성, 거래량, 지지·저항을 서로 다른 증거군으로 나누고 일치·충돌 여부를 설명하게 한다.
3. **표본 외 성능을 과신하지 않는다.** Brock, Lakonishok, LeBaron의 이동평균·돌파 규칙 연구는 역사적 예측력을 보고했지만, Fang, Jacobsen, Qin의 새로운 표본 검증에서는 같은 규칙의 시장 예측력을 확인하지 못했다. 따라서 출력은 확률적 표현과 무효화 조건을 포함한다.
4. **레버리지 ETF의 경로 의존성을 반영한다.** TQQQ와 SOXL은 일일 목표 수익률을 추종하는 레버리지 ETF다. 여러 날의 성과는 단순히 기초지수 수익률의 배수가 아니며 변동성·일별 복리의 영향을 크게 받는다. 모델 프롬프트에 이 점을 명시하고 ATR/실현변동성을 핵심 위험 척도로 사용한다.
5. **점추정과 범위를 함께 제시한다.** 각 거래일에 예상 종가뿐 아니라 예상 저가·고가 범위와 신뢰도(낮음/보통/높음)를 제공한다. 범위는 보장 구간이 아니라 현재 변동성을 반영한 시나리오 범위다.

## 3. 입력 데이터

- 최근 최대 3년, 약 750개 일봉의 `date, open, high, low, close, volume`
- 최신 캔들 날짜 이후의 다음 5개 미국 시장 예정 거래일
- 서버에서 계산한 최신 기술지표 스냅샷과 기간별 수익률·추세
- 종목 특성: TQQQ(나스닥100 일일 레버리지), SOXL(반도체 섹터 일일 레버리지)

가격 예측의 단위는 실제 화면과 같은 원시 종가 달러다. `adjusted_close`는 장기 수익률 점검에 참고할 수 있지만, 배당 조정 가격을 다음 실제 종가처럼 출력하지 않는다. 결측 또는 0 이하 값이 있는 캔들은 분석에서 제외한다. 최소 60개 유효 일봉이 없으면 분석을 실행하지 않는다.

## 4. 지표군과 해석

### 추세

- SMA(5, 10, 20, 50, 200): 단기 배열과 장기 국면을 확인한다.
- EMA(12, 26), MACD(12, 26, 9): 최근 가격에 더 큰 가중치를 둔 추세와 모멘텀 변화를 확인한다.
- 로그 종가 선형회귀 기울기(5, 20, 60일): 단순 시작/끝 비교보다 전 구간 방향성을 사용한다.

### 모멘텀

- RSI(14, Wilder 방식): 상승폭과 하락폭의 지수형 평활 비율이다. 과매수·과매도 숫자만으로 반전을 단정하지 않고 추세 지속 여부와 함께 본다.
- Stochastic %K(14): 최근 고저 범위 안에서 종가 위치를 측정한다.
- 1·5·20·60일 수익률: 여러 시간축의 방향 일치와 단기 과속 여부를 본다.

### 변동성

- True Range와 ATR(14, Wilder 방식): 갭을 포함한 현재의 전형적 일중 변동 폭을 측정한다.
- Bollinger Band(20, 2표준편차), 밴드 폭, %B: 변동성 수축/확장과 가격의 상대 위치를 본다.
- 20일 로그수익률 연율화 실현변동성: 5일 경로의 불확실성을 판단한다.

### 거래량과 가격 확인

- 20일 평균 대비 최신 거래량 비율: 돌파·반전 신호의 참여도를 확인한다.
- OBV의 20일 변화: 가격 방향과 누적 거래량 방향의 확인/괴리를 본다.

### 가격 구조

- 20·60일 최고/최저를 단기 지지·저항 후보로 사용한다.
- 최근 캔들의 몸통, 전체 범위, 갭을 전달해 추세 말단의 거부·확장 여부를 판단한다.
- 모델은 헤드앤숄더, 이중천장/바닥, 삼각수렴 같은 패턴을 언급할 수 있지만 수치 근거와 무효화 가격을 함께 제시해야 한다.

## 5. 예측 절차

1. 데이터 품질과 최신성, 표본 수를 확인한다.
2. 장기(200/60일), 중기(50/20일), 단기(10/5일) 국면을 분리한다.
3. 추세·모멘텀·변동성·거래량의 합의와 다이버전스를 찾는다.
4. 지지·저항과 ATR을 이용해 상승·기준·하락 시나리오를 비교한다.
5. 최신 실제 종가에서 시작해 다음 5개 거래일의 연속적인 경로를 만든다. 하루의 예측은 전날 예측과 논리적으로 연결되어야 하며 비정상적 점프에는 ATR·갭 근거가 필요하다.
6. 각 날짜의 예상 종가, 예상 범위, 신뢰도, 한 줄 근거를 구조화된 JSON으로 반환한다.
7. 서버에서 정확히 5개 날짜, 양수·유한 가격, `low <= close <= high`를 다시 검증한 뒤 저장한다.

## 6. OpenAI API 설계

- API: Responses API
- 모델: `gpt-5.6-luna`
- 추론 강도: `reasoning.effort: "xhigh"` (사용자 표현 “매우 높음”)
- 출력: strict JSON Schema 기반 Structured Outputs
- 실행: `background: true`로 요청해 페이지 연결과 무관하게 OpenAI에서 분석을 계속 수행
- 보관: `store: true`로 완료 응답을 나중에 회수할 수 있게 하고, 앱 DB에는 응답 ID·상태·구조화 결과·모델·캔들 범위를 저장
- 키: `OPENAI_API_KEY`를 서버 환경변수로만 읽으며 브라우저 번들·DB에 저장하지 않음

OpenAI 공식 문서상 GPT-5.6 Luna는 Responses API, 구조화 출력, `xhigh` reasoning effort를 지원한다.

## 7. UI와 저장

- 전략 상세의 차트 바로 아래에 `AI 차트 분석` 버튼을 둔다.
- 실행 중 중복 클릭을 막고, 완료하면 결과 영역을 자동으로 연다.
- 브라우저가 열려 있으면 5초 간격으로 상태를 확인한다. 페이지를 닫아도 OpenAI 백그라운드 분석은 계속되며, 같은 전략에 다시 들어오면 저장된 응답 ID로 상태와 결과를 회수한다.
- 결과는 기본적으로 접힌 `details`에 표시한다.
- 표시 항목: 한국시간 분석 시각, 사용 모델/분석 데이터 범위, 핵심 요약, 시장 국면, 기술적 근거, 주요 가격대, 5거래일 예측 표, 위험요인, 한계 고지.
- 매 실행은 `ai_chart_analyses`에 별도 행으로 저장하되 상세 화면에는 가장 최신 결과를 표시한다.

## 8. 실패·안전 처리

- API 키 없음, DB 스키마 미적용, 캔들 부족, OpenAI 오류, 불완전 응답, 스키마 위반을 사용자용 한국어 오류로 구분한다.
- API 키·전체 원문 응답·내부 추론은 로그나 클라이언트에 노출하지 않는다.
- 모델 출력은 HTML로 렌더링하지 않고 React 텍스트로 출력해 스크립트 주입을 막는다.
- 분석 버튼은 매매 실행과 연결하지 않는다.

## 9. 참고 자료

- Andrew W. Lo, Harry Mamaysky, Jiang Wang, *Foundations of Technical Analysis: Computational Algorithms, Statistical Inference, and Empirical Implementation*, NBER Working Paper 7613 (2000): https://www.nber.org/papers/w7613
- William Brock, Josef Lakonishok, Blake LeBaron, *Simple Technical Trading Rules and the Stochastic Properties of Stock Returns*, Journal of Finance 47(5) (1992): https://doi.org/10.1111/j.1540-6261.1992.tb04681.x
- Jiali Fang, Ben Jacobsen, Yafeng Qin, *Predictability of the simple technical trading rules: An out-of-sample test* (2014): https://doi.org/10.1016/j.rfe.2013.05.004
- U.S. SEC, leveraged/inverse ETF 위험 설명: https://www.sec.gov/newsroom/speeches-statements/schock-statement-single-stock-levered-or-inverse-etfs-071122
- OpenAI, GPT-5.6 Luna 모델: https://developers.openai.com/api/docs/models/gpt-5.6-luna
- OpenAI, Responses API: https://developers.openai.com/api/reference/resources/responses/methods/create
- OpenAI, Background mode: https://developers.openai.com/api/docs/guides/background
