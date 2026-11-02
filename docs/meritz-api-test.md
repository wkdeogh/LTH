# 메리츠 API 연결 테스트

Node.js 22 이상에서 추가 패키지 설치 없이 실행한다. 기존 앱 화면과 계산에는 연결하지 않는다.

1. [메리츠 개발자 포털](https://openapi.imeritz.com/api-apply)에서 발급한 값을 프로젝트의 `.env.local`에 추가한다.

   ```dotenv
   MERITZ_APP_KEY=발급받은_앱키
   MERITZ_APP_SECRET=발급받은_시크릿
   ```

   이 파일은 Git 제외 대상이다. 기존 설정은 보존한다. 이미 실행 환경에 설정된 값이 있으면 그 값을 우선한다.

2. `npm run test:meritz`로 토큰 발급 후 TQQQ와 SOXL 시세를 순서대로 조회한다.

   - `npm run test:meritz -- --probe`: 키 없이 서버 연결만 확인. 인증 오류 응답이 와도 서버 도달은 확인되며, 인증·시세 성공을 의미하지 않는다.
   - `npm run test:meritz -- --token-only`: 토큰 발급까지만 확인.
   - `npm run test:meritz -- --delayed`: 지연 시세로 조회.

공식 운영 서버 `https://openapi.imeritz.com:9443`만 사용한다. 모의계좌는 제공되지 않는다. 조회 테스트(`test-meritz.mjs`)가 보내는 요청은 토큰 발급 POST와 해외 현재가 GET뿐이다. 앱키·시크릿·접근토큰을 출력하거나 디스크에 저장하지 않는다.

토큰은 한 번 발급해 두 종목 조회에 재사용한다. MAC 주소는 로컬 네트워크 장치에서 읽는다. 자동으로 읽지 못하면 `MERITZ_MAC_ADDRESS`에 12자리 주소를 지정할 수 있다.

초기 거래소 코드는 TQQQ `OQ`, SOXL `AX`다. 실제 종목 매핑과 시세 제공 권한은 실응답으로 확인해야 한다. 서버가 현재가 기준 시각을 내려주지 않으므로 조회 성공만으로 가격의 최신성을 보증하지 않는다.

2026-11-02 실제 테스트에서 토큰 발급(유효기간 43,200초), TQQQ `OQ` 및 SOXL `AX` 조회가 모두 통과했다. 두 시세 응답은 HTTP 200, `rsp_cd=0000`, 요청과 일치하는 종목 코드와 USD 현재가를 반환했다.

성공 판정은 HTTP 상태만 보지 않고 공식 `rsp_cd` 성공 코드와 실제 응답 종목·양수 현재가를 함께 확인한다. 응답이 비면 조회 성공으로 표시하지 않는다. `5820`이라도 데이터가 있으면 검증한다. `0760`은 권한 확인이 필요하고, `EGW00200`은 호출 제한이다. 자동 재시도는 하지 않는다.

종료 코드: `0` 해당 테스트 통과, `1` 설정·연결·인증·시세 오류 또는 데이터 미확인, `2` 잘못된 실행 옵션. `--probe`의 통과 범위는 인증 전 서버 연결뿐이다.

## SOXL 1주 · $200 · LOC 매수 코드

별도 `scripts/test-meritz-order.mjs`에 요청한 주문을 고정했다. 기본 실행은 네트워크 요청 없이 URL과 JSON 본문을 출력한다.

```bash
npm run test:meritz:order
```

공식 해외 매수 명세에 맞춘 본문:

```json
{
  "ovrs_stck_symb_iscd": "SOXL",
  "ovrs_exch_vndr_idno": "0066",
  "oder_cls_code": "32",
  "oder_cond_cls_code": "7",
  "odqt": 1,
  "ovrs_stck_oder_prc": "200.0000",
  "warn_cnfr_yn": "N"
}
```

`0066`은 AMEX 주문용 벤더 코드다. 시세용 `AX`와 구분한다. LOC에는 주문구분 `32`와 종가 조건 `7`을 함께 넣는다. 계좌는 앱키에 연결되어 있으므로 계좌번호나 계좌 비밀번호를 본문에 넣지 않는다.

사용자가 로컬 터미널에서 실제 주문을 전송하려면 다음 명령을 직접 실행한다. `.env.local`의 키를 사용해 토큰을 발급하고 해외 매수 API에 **한 번** 전송한다.

```bash
MERITZ_READ_ONLY=0 npm run test:meritz:order -- --send
```

`--send`와 `MERITZ_READ_ONLY=0`이 모두 있어야 전송한다. 기본 미리보기는 키 파일도 읽지 않는다. 주문 전송 모드는 자동 테스트에서 실행하지 않는다.

`rsp_cd=0001`, `warn_cls_code=0`, 양수 주문번호가 모두 있어야 접수 성공이다. 접수 성공은 체결 확인이 아니다. 경고·보류 응답은 미접수로 보고 멈추며 경고 확인값을 자동 변경하거나 재전송하지 않는다. 응답 유실·시간초과·불완전 응답은 접수 여부 미확인으로 구분한다. 이 경우 재실행 전에 메리츠 주문내역에서 확인한다.

주문 스크립트 종료 코드: `0` 미리보기 완료 또는 접수 확인, `1` 설정·인증 실패나 주문 거절·경고, `2` 잘못된 옵션, `3` 전송 시도 후 접수 여부 미확인.

모의 응답 검증은 실제 키와 네트워크를 사용하지 않는다.

```bash
npm run test:meritz:order:unit
```

## 참고한 공식 자료

- [Python 예제 및 시작 안내](https://github.com/meritz-securities/open-api)
- [해외 시세 예제](https://github.com/meritz-securities/open-api/blob/a93c6409db73ea97ad15f7b7186f36c9f32ecd89/examples/03_overseas_market.py)
- [REST 명세](https://github.com/meritz-securities/open-api/blob/a93c6409db73ea97ad15f7b7186f36c9f32ecd89/openapi.json)
- [응답 판정 규칙](https://github.com/meritz-securities/open-api/blob/a93c6409db73ea97ad15f7b7186f36c9f32ecd89/llms.txt)
