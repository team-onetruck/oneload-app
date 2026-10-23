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

## 2. 현재 (2026-10-23, 작업 4 반영): 세션·채팅·언어 전환·위치 확인·경로 안내는 서버로 간다

`VITE_API_MODE`(기본 `http`)로 모드를 고른다. http 모드는 경로와 안내 이벤트도 서버를 부른다.

```
app (React, 브라우저)                                    backend (FastAPI /api/v1)
  screens.tsx   화면
      ↓
  store.tsx     상태. VITE_API_MODE로 http / mock 분기
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
      └─ [mock] 전부 로컬
            features/session/mockSession.ts, assistant.ts, route.ts, data.ts
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

- mock 모드는 아직 `ApiAdapter` 구현이 아니라 `store.tsx`의 `API_MODE` 분기로 동작한다. 3장의 mock adapter는 목표 구조다.
- 단계 진행('다음')은 화면 상태로만 두고 서버에 알리지 않는다. 서버 세션의 `state`·`revision`은 경로와 안내 이벤트 응답으로 바뀐다.
- mock 모드의 경로는 `route.ts`의 `findRoute`(다익스트라)다. `features/route/guide.ts`가 서버 경로와 같은 화면 모델로 바꾼다.
- 백엔드 쪽은 그대로다: `RuleAgent`(키워드 규칙)와 `NoVision`(사진은 503)이 기본이고, agent 레포의 `LLMAgent`는 아직 연결되지 않았다.

## 3. To-Be: API 계층을 두고 서버를 진실로 삼는다

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

## 4. 변경 대응표

| 현재 (app) | 바뀐 뒤 |
| --- | --- |
| `store.tsx`가 세션 상태와 `revision`을 직접 증가 | 서버 응답의 `session.state`, `revision`을 그대로 반영 |
| `assistant.ts`의 `classify` / `render` | `POST /sessions/{id}/messages` 응답의 `status`, `items`, `tip`, `sources` 표시 |
| `route.ts` 다익스트라와 `data.ts` EDGES | `POST /routes`의 `steps`로 안내 |
| 사진 분석 타이머 | `POST .../localizations` 호출, 503이면 직접 선택으로 전환 |
| `data.ts` 전체 | `mock adapter`로 격리해 서버 없이 데모용으로 사용 |

## 5. 하네스 구성

| 요소 | 위치 | 역할 |
| --- | --- | --- |
| 프로젝트 규칙 | `CLAUDE.md` | 작성 규칙, API 규칙, 작업 목록 |
| 훅 | `.claude/settings.json` | 편집 후 lint + 타입체크, 종료 전 `pnpm verify` |
| 검증 | `pnpm verify` | 헤더 검사 + lint + 타입체크 + vitest |
| 헤더 검사 | `scripts/check-header.mjs` | 새 파일의 Date / Author / Purpose 확인 |
| CI | `.github/workflows/ci.yml` | push·PR마다 `pnpm verify`, e2e는 독립 job (`test:e2e` 스크립트가 생기면 실행) |
| CD 초안 | `.github/workflows/deploy.yml` | 지금은 수동 실행만. main을 빌드해 macserver로 rsync. 활성화 절차는 `docs/ci-cd.md` |
