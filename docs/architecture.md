<!--
Date: 2026-10-23
Author: Jung Minkyu
Purpose: app의 현재(As-Is)와 목표(To-Be) 아키텍처, 기술 스택, 변경 대응표 정리
-->

# 아키텍처: As-Is / To-Be

## 1. 기술 스택

| 영역 | 스택 | 비고 |
| --- | --- | --- |
| app | React 19, TypeScript, Vite, pnpm, oxlint | 라우터, 서버 상태 라이브러리, CI 없음. 상태는 `store.tsx` 하나에 몰려 있음 |
| app 부가 | photo-sphere-viewer(360° 사진), lucide, Pretendard | |
| backend | FastAPI, SQLAlchemy + Alembic, Postgres 17 + pgvector, networkx, uv | 요청 ID, JSON 로그, `Idempotency-Key`, `revision` 낙관적 락 |
| agent (로컬 폴더 `infra/`) | Python, OpenAI LLM, FakeLLM 테스트, eval 17문항 | `LLMAgent`, `LLMVision`이 백엔드 규격에 맞게 구현됐지만 아직 연결 안 됨 |
| 배포 | macserver, Caddy가 `/api/*`를 백엔드로 프록시, Tailscale Funnel | 프론트와 백엔드가 같은 origin |

## 2. As-Is: 서로 호출하지 않는다

```
┌─ app (React, 브라우저) ───────────┐        ┌─ backend + agent (Python) ──────────┐
│ screens.tsx                       │        │ FastAPI /api/v1                     │
│   9개 화면, UI만                   │        │   sessions, routes, maps            │
│        ↓                          │        │        ↓                            │
│ store.tsx                         │        │ RuleAgent + NoVision                │
│   상태 머신 (mock)                 │  ✕ 호출 │   키워드 규칙, 사진은 503            │
│        ↓                          │   0건   │        ↓                            │
│ assistant.ts, route.ts            │        │ Postgres + 지도 파일                 │
│   키워드 규칙, 다익스트라           │        │   oneload-data 레포                 │
│        ↓                          │        │                                     │
│ data.ts                           │        │ LLMAgent (agent 레포)               │
│   노드, 엣지, 파노라마              │        │   만들어졌지만 미연결                │
└───────────────────────────────────┘        └─────────────────────────────────────┘
```

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
