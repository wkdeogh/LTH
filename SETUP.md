# 로컬 실행 및 Supabase 설정

## 1. Supabase 프로젝트 생성

1. Supabase에서 새 프로젝트를 만듭니다.
2. Project Settings에서 `Project URL`을 확인합니다.
3. Project Settings > API에서 `service_role` 키를 확인합니다.

`service_role` 키는 절대 브라우저에 노출하면 안 됩니다. 이 앱은 서버 코드에서만 사용하도록 구성되어 있습니다.

## 2. DB 테이블 생성

Supabase SQL Editor에서 아래 파일 내용을 실행합니다.

```text
supabase/schema.sql
```

`permission denied for table strategies`가 나오면 SQL Editor에서 아래 권한 부여 SQL을 한 번 더 실행합니다.

```sql
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;

notify pgrst, 'reload schema';
```

그리고 `.env.local`의 `SUPABASE_SERVICE_ROLE_KEY`가 `anon public` 키가 아니라 `service_role` 키인지 확인합니다.

## 3. 환경변수 설정

프로젝트 루트에 `.env.local` 파일을 만들고 아래 값을 넣습니다.

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

## 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 아래 주소로 접속합니다.

```text
http://localhost:3000
```

## 5. 첫 사용 순서

1. `전략 추가`를 누릅니다.
2. 종목, 분할 수, 원금, 현금, 보유수량, 평단, T값을 입력합니다.
3. 전략 상세 화면에서 최근 종가를 입력합니다.
4. `오늘 주문 계산`을 눌러 매수/매도 가이드를 확인합니다.
5. 증권사 앱에서 직접 주문합니다.
6. 체결 후 `체결 입력`에서 최종 현금, 보유수량, 평단, T값을 저장합니다.

## 6. 검증 명령

```bash
npm run typecheck
npm run build
```

현재 구현은 두 명령 모두 통과해야 정상입니다.
