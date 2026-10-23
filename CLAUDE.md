<!--
Date: 2026-10-23
Author: Jung Minkyu
Purpose: Claude Code가 이 레포에서 따를 프로젝트 규칙, 검증 명령, 작업 목록
-->

# oneload-app

서울역 / 공항철도 시나리오용 한길(Hangil) 모바일 웹 데모 클라이언트. React 19 + TypeScript + Vite, pnpm.
제품 배경은 `PRODUCT.md`, 실행·배포는 `README.md`, 구조는 `docs/architecture.md`를 본다.

## 명령어

- `pnpm dev`: 개발 서버 (http://localhost:5173)
- `pnpm verify`: 헤더 검사 + lint + 타입체크 + 단위 테스트. 모든 작업은 이게 통과해야 끝난 것이다.
- `pnpm test`: vitest 1회 실행
- `pnpm e2e`: Playwright E2E. 개발 서버를 `VITE_API_MODE=mock`으로 띄운다. 느려서 verify에는 넣지 않는다. 처음 한 번 `pnpm exec playwright install chromium`
- `pnpm build`: 타입체크 후 프로덕션 빌드

## 작성 규칙 (사용자 지정)

- 새로 쓰는 주석, 문서, 테스트 이름은 한국어로 쓴다.
- 새 파일(.ts .tsx .mjs .md)은 맨 위에 아래 헤더를 넣는다. 주석 문법이 없는 JSON은 제외한다. `pnpm verify`가 검사한다.

  ```
  Date: YYYY-MM-DD (작성한 날짜)
  Author: Jung Minkyu
  Purpose: 작성 목적
  ```

- 커밋 메시지와 PR 본문에 Claude 워터마크를 넣지 않는다 (Co-Authored-By, "Generated with Claude Code" 등).
## 커밋 규칙

- 커밋은 의미 단위로 쪼갠다. 한 커밋은 한 가지 이유만 담고, 되돌려도 앱이 깨지지 않아야 한다.
  (예: 타입 생성 / 클라이언트 / 화면 연결 / 테스트는 각각 따로)
- 커밋 전에 반드시 `pnpm verify`를 통과시킨다. `--no-verify`로 우회하지 않는다.
- 메시지 형식은 `타입: 한국어 요약` 한 줄(50자 안팎)이다. 타입은 `feat`, `fix`, `refactor`, `test`, `docs`, `chore` 중 하나.
  이유가 필요하면 빈 줄 뒤에 본문을 쓴다. 워터마크 문구는 넣지 않는다.
- 파일은 이름을 지정해서 스테이징한다 (`git add -A` 금지). `.env`, 토큰, `node_modules`는 올리지 않는다.
- 작업 목록 한 항목이 끝나면 CLAUDE.md의 체크박스를 `[x]`로 바꾸는 변경을 같은 PR에 넣는다.
- 사용자가 요청하기 전에는 `git push`, PR 생성, 브랜치 삭제를 하지 않는다.
- 작업 도중 범위 밖의 문제를 발견하면 고치지 말고 보고만 한다.

## 코드 스타일

- 기존 코드 스타일을 따른다: 세미콜론 없음, 작은따옴표, 2칸 들여쓰기, 타입은 `import type`.
- 테스트는 코드 옆에 `*.test.ts`로 둔다.

## 현재 작업: mock을 백엔드로 교체 (`feature/api-integration`)

지금은 `src/store.tsx`, `src/assistant.ts`, `src/route.ts`가 서버를 흉내 낸다.
백엔드 계약은 `../backend/app/schemas.py`이고 `/api/v1/docs`에서 볼 수 있다. 백엔드 코드는 읽기만 한다.

### 규칙

- `session.state`와 `session.revision`은 서버 응답을 그대로 쓴다. 클라이언트가 올리거나 만들어 내지 않는다.
- 서버 호출은 `src/api/` 안에서만 한다. 화면(screens)은 `fetch`를 직접 호출하지 않는다.
- 응답 타입은 백엔드 OpenAPI 문서에서 생성한다. 손으로 복사해 쓰지 않는다.
- `409 REVISION_CONFLICT`: `GET /sessions/{id}/navigation-state`로 상태를 다시 읽고 한 번만 재시도한다.
- 사진 업로드에서 `503 AI_SERVICE_UNAVAILABLE`이 오면 직접 선택 화면으로 넘기고, 위치를 추측하지 않는다.
- 요금, 위치, 경로를 지어내지 않는다. 서버의 `unverified_notes`는 "Not verified"로 그대로 보여 준다.
- 위치는 사용자가 명시적으로 고른 경우에만 확정한다.
- 서버 없이도 데모가 돌도록 mock 경로는 어댑터 뒤에 남겨 둔다.

### 작업 목록 (한 항목 = 한 PR, 끝나면 체크)

- [x] 0. 하네스 세팅 (vitest, verify, 훅, CLAUDE.md)
- [x] 1. `src/api/` 클라이언트와 타입 생성 (토큰, `expected_revision`, `Idempotency-Key`)
- [x] 2. 세션 생성 + 메시지 연동 (채팅에 서버 응답과 출처 표시)
- [x] 3. 사진 업로드 + 위치 확정 (503 폴백 포함)
- [x] 4. 경로 + 이벤트 연동 (서버 `steps`로 안내, 도착 이벤트 전송)
- [x] 5. 오류 복구 (409 재동기화, 타임아웃 재시도)
- [ ] 6. MSW 테스트 하네스와 Playwright 시나리오 3개
- [x] 7. GitHub Actions에서 `pnpm verify` 실행
