<!--
Date: 2026-10-23
Author: Jung Minkyu
Purpose: app의 현재(As-Is)와 목표(To-Be) 아키텍처, 기술 스택, 변경 대응표 정리
-->

# 아키텍처: As-Is / To-Be

## 1. 기술 스택

| 영역 | 스택 | 비고 |
| --- | --- | --- |
| app | React 19, TypeScript, Vite, pnpm, oxlint | 라우터, 서버 상태 라이브러리 없음. 상태는 `store.tsx` 하나에 몰려 있음 |
| app 부가 | photo-sphere-viewer(360° 사진), lucide, Pretendard | |
| backend | FastAPI, SQLAlchemy + Alembic, Postgres 17 + pgvector, networkx, uv | 요청 ID, JSON 로그, `Idempotency-Key`, `revision` 낙관적 락 |
| agent (로컬 폴더 `infra/`) | Python, OpenAI LLM, FakeLLM 테스트, eval 17문항 | `LLMAgent`, `LLMVision`이 백엔드 규격에 맞게 구현됐지만 아직 연결 안 됨 |
| 배포 | macserver, Caddy가 `/api/*`를 백엔드로 프록시, Tailscale Funnel | 프론트와 백엔드가 같은 origin |

## 2. 현재 (2026-10-23, #25 기준): 3장의 목표 구조를 달성했다

`VITE_API_MODE`(기본 `http`)로 어댑터를 고른다. http 모드는 화면의 모든 기능이 서버를 부르고, mock 모드는 같은 호출을 mock 어댑터가 서버 없이 받는다. 서버 응답(mock 모드에서는 mock 어댑터 응답)의 `session.state`·`revision`이 유일한 상태 원천이다.

```
app (React, 브라우저)                                    backend (FastAPI /api/v1)
  screens.tsx   화면
      ↓
  store.tsx     상태. 서버 호출은 src/api 어댑터 하나로만 한다 (모드 분기는 src/api/index.ts 한 곳)
      │
      ├─ [http] 세션 생성 · 채팅 · 언어 전환 · 목적지 목록 · 사진 위치 · 위치 확정 · 경로 · 안내 이벤트
      │     features/session, chat, recovery, localization, map, route
      │     → src/api (http adapter, fetch)  ──────────▶  POST /sessions
      │                                                   POST /sessions/{id}/messages
      │                                                   PATCH /sessions/{id}
      │                                                   GET  /sessions/{id}/navigation-state
      │                                                   POST /sessions/{id}/localizations
      │                                                   POST /sessions/{id}/location-confirmations
      │                                                   POST /sessions/{id}/routes
      │                                                   POST /sessions/{id}/navigation-events
      │                                                   GET  /maps/{id}/graph
      │                                                   GET  /maps/{id}/pois
      │
      └─ [mock] 같은 호출을 src/api/mockAdapter.ts가 서버 없이 받는다
            assistant.ts, data.ts, route.ts, api/sessionMachine.ts로 서버와 같은 모양의 응답을 만든다
```

| 백엔드 엔드포인트 | `src/api` 함수 | 화면에서 호출 (http 모드) |
| --- | --- | --- |
| `POST /sessions` | `createSession` | 연결됨: 시작 화면의 Start |
| `POST /sessions/{id}/messages` | `sendMessage` | 연결됨: 채팅 입력·칩·추천 답변, 목적지 목록 선택, "길을 잃었어요" |
| `PATCH /sessions/{id}` | `patchSession` | 연결됨: 세션 시작 후 언어 전환 |
| `GET /sessions/{id}/navigation-state` | `getNavigationState` | 연결됨: 언어 전환·위치 확정·경로의 409 재동기화, 채팅·사진·위치 확정·경로의 `INVALID_STATE` 재동기화, 재탐색 판단(`planReroute`), 이미 닫힌 경로의 이벤트 422 뒤 상태 맞추기 |
| `POST /sessions/{id}/localizations` | `postLocalization` | 연결됨: 위치 확인 화면의 사진 찍기 (`features/localization/flow.ts`). 503이면 직접 선택 화면으로 간다 |
| `POST /sessions/{id}/location-confirmations` | `confirmLocation` | 연결됨: 후보 화면의 "여기예요", 직접 선택 목록 |
| `GET /maps/{id}/graph` | `getMapGraph` | 연결됨: 위치 확인 화면이나 경로 요청 때 한 번 받아 직접 선택 목록, 후보 이름, 경로 화면의 노드 이름·사진, 경로 요청의 `map_version`에 쓴다 (`features/map/graphCache.ts`) |
| `POST /sessions/{id}/routes` | `createRoute` | 연결됨: 위치 확정 뒤, 채팅의 "길안내 시작", 길을 잃은 뒤 위치를 다시 확정했을 때(`reroute: true`) (`features/route/flow.ts`). 응답 steps는 `toSteps`·`guide`로 화면 모델이 된다 |
| `POST /sessions/{id}/navigation-events` | `postNavigationEvents` | 연결됨: 경로를 받으면 `navigation_started`, 도착하면 `arrived`, 안내 중 처음으로 가면 `navigation_cancelled` (`features/route/events.ts`, `flow.ts`의 `deliverEvents`). 실패해도 안내를 막지 않는다 |
| `GET /maps/{id}/pois` | `searchPois` | 연결됨: 목적지 목록 화면에 들어오면(도착 화면에서는 표 사는 곳인지 판단할 때) 검색어 없이 지도마다 한 번 받는다 (`features/map/destinations.ts`, `graphCache.ts`의 `createMapCache`). 고른 `poi_id`를 그대로 `/messages`의 `selected_poi_id`로 보낸다 |
| `GET /health`, `GET /maps`, `POST /sessions/{id}/feedback` | `getHealth` 등 | 화면에서 쓰지 않는다 |
| (데모 패널) | 없음 | 사진 결과 선택과 위치 확인 화면의 데모 사진은 mock 모드에서만 보인다(`src/api/index.ts`의 `demoMode`). http 모드의 사진은 `/localizations` 응답을 따른다 |

- mock 모드도 `ApiAdapter` 구현(`src/api/mockAdapter.ts`)이다. 모드 분기는 `src/api/index.ts`에서 어댑터를 고르는 한 곳뿐이고 store는 어댑터 하나만 본다. 세션 상태 기계(`src/api/sessionMachine.ts`)는 mock 어댑터와 MSW 핸들러가 함께 쓴다.
- 단계 진행('다음')은 화면 상태로만 두고 서버에 알리지 않는다. 서버 세션의 `state`·`revision`은 경로와 안내 이벤트 응답으로 바뀐다.
- mock 어댑터의 경로는 `route.ts`의 `findRoute`(다익스트라) 결과를 `RouteOut` 모양으로 돌려준 것이다. 화면은 http와 같은 `serverGuide`로 그린다.
- 백엔드 쪽은 그대로다: `RuleAgent`(키워드 규칙)와 `NoVision`(사진은 503)이 기본이고, agent 레포의 `LLMAgent`는 아직 연결되지 않았다.

## 3. To-Be: API 계층을 두고 서버를 진실로 삼는다 (달성됨, #25)

아래는 처음 세운 목표 그림이다. 2장이 그 결과이고, 그림의 각 칸은 아래 표의 파일로 구현됐다.

```
┌─ app (React, 브라우저) ────────────────┐         ┌─ backend + agent ─────────┐
│ screens                                │         │ FastAPI /api/v1           │
│   UI만, 업무 규칙 없음                  │         │   진실의 원천              │
│        ↓                               │         │        ↓                  │
│ features: session, chat, route         │         │ Agent + Vision            │
│   훅, 서버 상태를 그대로 반영            │         │   지금은 규칙, 이후 LLM    │
│        ↓                               │         └───────────────────────────┘
│ api client                             │                    ↑
│   타입, 토큰, revision, 재시도          │                    │ HTTPS /api/v1
│      ↓                  ↓              │                    │
│ mock adapter        http adapter ──────┼────────────────────┘
│ (기존 data.ts, 데모)  (fetch)           │
└────────────────────────────────────────┘
```

| 목표 칸 | 구현 | 목표와 다른 점 |
| --- | --- | --- |
| screens | `src/screens.tsx`, `src/streetview.tsx` | 첫 인사 말풍선은 아직 `assistant.ts`의 `render`로 그린다 |
| features | `src/features/{session,chat,recovery,localization,map,route}` | 훅이 아니라 순수 함수다. 화면 상태는 여전히 `store.tsx` 하나에 모여 있다 |
| api client | `src/api/client.ts`(토큰, `Idempotency-Key`, 타임아웃, `ApiError`), `revision.ts`(409 재동기화), `mapVersion.ts`(지도 버전 재시도), `multipart.ts`(재시도해도 같은 사진 본문) | |
| http adapter | `src/api/httpAdapter.ts` | |
| mock adapter | `src/api/mockAdapter.ts`, 세션 상태 기계 `src/api/sessionMachine.ts`(MSW 핸들러와 공유) | `data.ts`는 mock 어댑터 밖에서도 타입과 열차 이름(`TRAIN_NAME`)으로 쓴다 |

## 4. 변경 대응표

| 처음 (app) | 바뀐 뒤 | 상태 |
| --- | --- | --- |
| `store.tsx`가 세션 상태와 `revision`을 직접 증가 | 서버 응답의 `session.state`, `revision`을 그대로 반영 | [x] 작업 2. 늦게 온 옛 응답은 `revision`이 작으면 버린다 |
| `assistant.ts`의 `classify` / `render` | `POST /sessions/{id}/messages` 응답의 `status`, `items`, `tip`, `sources` 표시 | [x] 작업 2. `classify`는 mock 어댑터만 쓰고, `render`는 첫 인사 말풍선에만 남았다 |
| `route.ts` 다익스트라와 `data.ts` EDGES | `POST /routes`의 `steps`로 안내 | [x] 작업 4. `route.ts`는 mock 어댑터만 쓴다 |
| 사진 분석 타이머 | `POST .../localizations` 호출, 503이면 직접 선택으로 전환 | [x] 작업 3. 타이머는 mock 어댑터 안으로 옮겼다 |
| `data.ts` 전체 | `mock adapter`로 격리해 서버 없이 데모용으로 사용 | [x] 작업 6(#25). 값은 mock 어댑터가 쓰고, 화면은 타입과 `TRAIN_NAME`만 가져온다 |

## 5. 하네스 구성

| 요소 | 위치 | 역할 |
| --- | --- | --- |
| 프로젝트 규칙 | `CLAUDE.md` | 작성 규칙, API 규칙, 작업 목록 |
| 훅 | `.claude/settings.json` | 편집 후 lint + 타입체크, 종료 전 `pnpm verify` |
| 검증 | `pnpm verify` | 헤더 검사 + lint + 타입체크 + vitest |
| 헤더 검사 | `scripts/check-header.mjs` | 새 파일의 Date / Author / Purpose 확인 |
| 타입 생성 | `scripts/gen-api.mjs` (`pnpm gen:api`) | 백엔드 OpenAPI 문서로 `src/api/schema.d.ts` 생성 |
| 백엔드 흉내 | `src/test/handlers.ts` (MSW) | vitest와 http 모드 E2E가 같이 쓰는 `/api/v1` 핸들러. 409·503·타임아웃 스위치 |
| E2E | `playwright.config.ts`, `e2e/` (`pnpm e2e`) | 11개. mock 프로젝트(스모크 2 + 기준선 5, 4179)와 http 프로젝트(시나리오 3 + 모드 라벨 1, 4180, `page.route`로 MSW 응답) |
| CI | `.github/workflows/ci.yml` | push·PR마다 `pnpm verify`. e2e는 독립 job으로 11개를 돌리고, Playwright 브라우저를 버전별로 캐시해 캐시가 있으면 시스템 라이브러리 설치를 건너뛴다 |
| CD 초안 | `.github/workflows/deploy.yml` | 지금은 수동 실행만. main을 빌드해 macserver로 rsync. 활성화 절차는 `docs/ci-cd.md` |
