# 한길 (Hangil) web prototype

Clickable, phone-sized prototype of the Hangil demo client for the Seoul Station / AREX scenario: a foreign visitor who doesn't know how tickets, transit cards and cash work, gets to the right ticket point and platform.

**연결 상태 (2026-10-23, #25 기준, 연동 작업 완료).** `VITE_API_MODE`로 mock 모드와 http 모드를 고른다. 두 모드 모두 화면은 같은 `ApiAdapter` 호출을 쓴다. http 모드(기본)에서는 세션 생성, 채팅, 언어 전환, 목적지 목록, 사진 위치 인식, 위치 확정, 경로 안내, 안내 시작·도착·취소가 모두 서버로 동작한다. mock 모드는 서버를 부르지 않고, 같은 호출을 브라우저 안의 mock 어댑터(`src/api/mockAdapter.ts`, 데모 규칙)가 서버와 같은 모양으로 답한다. 기능별 상태는 [백엔드 연결](#백엔드-연결-vite_api_mode) 표를 본다.

- Floors of AREX ticket points (B2 express, B3 all-stop) and platforms (B7) follow the [AREX official guide](https://www.airportrailroad.com/co/steUsfGud.do), checked 2026-10-22.
- Passages, distances, sign wording and "demo doc" sources are placeholders until the field survey.

## Street view

The route screen has a **Line / Street view** toggle. Street view shows a 360° photo of the current point with a floor arrow toward the next one; **Next** steps to the next photo.

- Each node stores one panorama and `northYaw` (where map north sits in the photo). The arrow angle is `northYaw + leg heading`, so no per-route arrow data is stored.
- http 모드는 서버 경로 단계의 `arrow_yaw_deg`(서버가 사진의 북쪽 + 통로 방향으로 계산)를 그대로 쓰고, 사진 주소는 `pano_id`로 `GET /maps/{id}/graph`의 `image_url`을 찾는다. 서버 값이 없을 때만 그래프의 `north_yaw_deg + heading_deg`로 계산한다. 서버 사진은 예시 여부(`is_example`)만 있어서 "예시 사진 · 서울역 아님" 공통 문구를 붙인다.
- The photos in `public/panos/` are **CC0 samples of other stations** from [Poly Haven](https://polyhaven.com) (Hamburg Hbf, a subway passage, Amsterdam Noord and Vijzelgracht), labelled "Example photo" on screen. Replace them with the Seoul Station field shoot; faces must be blurred before publishing.
- Points without a photo show a "no photo yet" panel; ticket counters and machines have none yet.

## Run

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # static files in dist/
```

Desktop shows a 390×844 phone frame; on a phone it fills the screen.

### 백엔드 연결 (`VITE_API_MODE`)

| 값 | 동작 |
| --- | --- |
| `http` (기본, `mock`이 아닌 모든 값) | 아래 표에서 "서버 연결됨"인 기능은 백엔드 `/api/v1`을 호출한다 |
| `mock` | 서버를 부르지 않는다. 화면은 http와 같은 경로로 호출하고, mock 어댑터(`src/api/mockAdapter.ts`)가 키워드 규칙(`assistant.ts`), 데모 지도(`data.ts`), 경로 탐색(`route.ts`)으로 서버와 같은 모양의 응답을 준다 |

http 모드의 기능별 상태 (`src/store.tsx` 기준):

| 기능 | 상태 | 호출과 동작 |
| --- | --- | --- |
| 세션 시작 ("Start") | 서버 연결됨 | `POST /sessions` |
| 채팅 (입력, 칩, 추천 답변) | 서버 연결됨 | `POST /sessions/{id}/messages`. 답변·목록·출처와 `unverified_notes`("Not verified", 한국어 화면은 "확인되지 않음")는 서버 응답을 표시한다. 사진을 붙이면 JPEG 2MB 이하로 줄여 multipart로 보낸다. 지금 단계에서 할 수 없는 요청(`INVALID_STATE`)이면 `GET /sessions/{id}/navigation-state`로 상태를 다시 읽는다 |
| 목적지 목록에서 고르기 | 서버 연결됨 | 목록은 `GET /maps/{id}/pois`를 지도마다 한 번 받아 이름(한·영), 분류, 열차, 층을 보여 주고, `verified: false`면 "확인되지 않음"을 붙인다(지금 서버는 확인된 장소만 돌려준다). 고른 서버 `poi_id`를 그대로 `selected_poi_id`로 `/messages`에 보낸다 |
| "길을 잃었어요" | 서버 연결됨 | 문장을 `/messages`로 보내고(서버는 확정 위치만 지우고 목적지·경로는 남긴다) 위치 확인 화면으로 넘어간다. 위치를 다시 확정하면 `GET /sessions/{id}/navigation-state`로 확인한 뒤 같은 목적지를 `reroute: true`로 다시 계산한다 |
| 언어 전환 (세션 시작 후) | 서버 연결됨 | `PATCH /sessions/{id}`. `409 REVISION_CONFLICT`면 navigation-state로 맞춘 뒤 한 번 다시 보낸다. 세션 전에는 화면 언어만 바꾼다 |
| 사진으로 위치 찾기 | 서버 연결됨 | JPEG 2MB 이하로 줄여 `POST /sessions/{id}/localizations`로 보낸다. 후보는 근거와 함께 보여 주고 저절로 확정하지 않는다. 후보가 없으면 서버의 `retake_hint`를, `503 AI_SERVICE_UNAVAILABLE`(지금 서버의 `NoVision`)이면 직접 선택 화면을 보여 준다. 데모 사진은 mock 모드에서만 보인다 |
| 위치 확정 | 서버 연결됨 | 사용자가 누른 후보(`photo_candidate`)나 목록 항목(`manual`)만 `POST /sessions/{id}/location-confirmations`로 보낸다. `409 REVISION_CONFLICT`면 navigation-state로 맞춘 뒤 한 번 다시 보낸다. 직접 선택 목록은 `GET /maps/{id}/graph`의 노드 전체다 |
| 경로 안내 | 서버 연결됨 | 위치 확정 뒤(또는 "길안내 시작") `POST /sessions/{id}/routes`. 단계의 문구·거리·사진(`pano_id`)·화살표(`arrow_yaw_deg`)는 서버 값을 쓰고, 노드 이름과 사진 주소는 `GET /maps/{id}/graph`에서 찾는다. `409 REVISION_CONFLICT`면 navigation-state로 맞춘 뒤 한 번 다시 보낸다. 등록된 경로가 없으면(`ROUTE_NOT_FOUND`) 경로를 지어내지 않고 안내만 보여 준다 |
| 안내 시작·도착·취소 | 서버 연결됨 | `POST /sessions/{id}/navigation-events`. 경로를 받으면 `navigation_started`, 마지막 단계를 넘기면 `arrived`, 안내 중 처음으로 가면 `navigation_cancelled`를 보낸다. 실패해도 안내는 막지 않고, 같은 `Idempotency-Key`로 한 번 다시 보낸 뒤 남은 이벤트는 다음 이벤트와 함께 보낸다 |
| 처음으로 (초기화) | 로컬 (취소 이벤트만 서버로) | 안내 중이면 `navigation_cancelled`를 보낸 뒤 보관한 세션 토큰을 지운다. 서버 세션은 2시간 동안 요청이 없으면 만료된다 |

'다음' 버튼은 화면의 단계만 넘기고 서버를 부르지 않는다. 서버 세션 상태(데모 패널의 state·rev)는 경로와 안내 이벤트 응답으로 바뀐다.
목적지는 서버 `poi_id` 하나로 다룬다(데모 `data.ts`의 목적지 id는 mock 모드에서만 쓴다). 도착 화면의 "표 사는 법" 버튼은 목적지 POI의 `category`가 `tickets`인지로 정한다.

| 환경변수 | 기본값 | 쓰는 곳 |
| --- | --- | --- |
| `VITE_API_MODE` | `http` | `src/api/mode.ts`. `mock`일 때만 mock 모드 |
| `VITE_API_BASE_URL` | `/api/v1` | `src/api/client.ts`. 앱이 부르는 API 주소 |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:8000` | `vite.config.ts`. 개발 서버가 `/api`를 넘길 곳 |

개발 서버는 `/api`를 `VITE_API_PROXY_TARGET`으로 프록시한다. 배포처럼 같은 origin이라 CORS 설정이 필요 없다.

```sh
pnpm dev                                                                  # 로컬 백엔드 (../backend README의 Run locally)
VITE_API_PROXY_TARGET=https://baki-macbookpro.tail3286a4.ts.net:10000 pnpm dev   # 배포 서버
VITE_API_MODE=mock pnpm dev                                               # 서버 없이
```

### 테스트

```sh
pnpm verify   # 헤더 검사 + oxlint + 타입체크 + vitest. 커밋 전에 반드시 통과시킨다
pnpm e2e      # Playwright(pnpm test:e2e). 개발 서버를 mock(4179)·http(4180) 모드로 하나씩 띄운다. 처음 한 번 pnpm exec playwright install chromium
```

E2E는 11개이고 `playwright.config.ts`의 두 프로젝트로 나뉜다.

| 프로젝트 | 개발 서버 | 테스트 |
| --- | --- | --- |
| `mock` | `VITE_API_MODE=mock`, 4179 | `e2e/smoke.spec.ts` 2개(시작 화면, Demo 라벨), `e2e/mock/` 기준선 5개 |
| `http` | `VITE_API_MODE=http`, 4180 | `e2e/scenarios/` 4개(시나리오 3, Live 라벨 1). `/api/v1`은 `page.route`로 가로채 MSW 핸들러가 답한다 |

두 명령 모두 서버 없이 돈다. vitest는 가짜 fetch와 MSW 핸들러로 백엔드 계약을 흉내 낸다. Playwright 스모크는 mock 모드에서 시작 화면이 뜨는지 보고,
시나리오 3개(직통열차, 일반열차+카드 없음, 사진 503 → 직접 선택)는 http 모드에서 `/api/v1`을 가로채 같은 MSW 핸들러가 답하게 해 화면 흐름과 요청 순서를 본다(`e2e/support/mockApi.ts`).
mock 기준선 5개(`e2e/mock/`)는 서버 없는 데모 흐름이 그대로인지, `/api`로 나가는 요청이 없는지 본다.
그래서 실서버에서 채팅 → 사진 → 경로 전체 흐름이 동작한다는 증거는 아니다. 자세한 범위는 [docs/ci-cd.md의 검증 범위](docs/ci-cd.md#검증-범위-무엇을-증명하고-무엇을-증명하지-않는가)를 본다.

## Deploy (macserver)

`dist/` is synced to `macserver:~/hangil-demo/dist`. Caddy on `127.0.0.1:4173` serves it (zstd/gzip, immutable cache for `/assets`), proxies `/api/*` to the backend and serves `/panos/*` from [oneload-data](https://github.com/team-onetruck/oneload-data); Tailscale Funnel exposes all of it at `https://baki-macbookpro.tail3286a4.ts.net:10000/`. The server setup lives in [oneload-infra](https://github.com/team-onetruck/oneload-infra).

```sh
pnpm build && rsync -a --delete dist/ macserver:~/hangil-demo/dist/
```

## Demo controls

The **Demo** pill (top of the desktop frame; on phones open the URL with `?demo` to get a slim tab on the right edge) opens the demo panel.
라벨은 모드를 따른다(`src/i18n.ts`의 `modeCopy`): mock 모드는 상단 필 **Demo**(데모), 패널 제목 *Demo controls*(데모 설정), 시작 화면의 "Prototype…" 문구이고, http 모드는 **Live**(실서버), *Dev controls*(개발자 설정), "Connected to the Hangil server…"(한길 서버에 연결돼 있어요…) 문구다.
패널에 보이는 항목과 동작은 모드마다 다르다 (`src/screens.tsx`의 `DemoPanel`, `src/api/index.ts`의 `demoMode`).

| 항목 | mock 모드 | http 모드 |
| --- | --- | --- |
| 세션 상태 줄 (state · rev · 모드) | mock 어댑터 응답의 `session.state`·`revision` | 서버 응답의 `session.state`·`revision`. 세션 id도 함께 보인다 |
| 다음 AI 요청 실패시키기 (Next AI request times out) | http와 같다. 다음 채팅 요청의 첫 시도를 타임아웃으로 처리하고, 오류 알림의 다시 시도로 답을 받는다 | 다음 채팅 요청(`/messages`)의 첫 시도를 보내지 않고 타임아웃으로 처리한다. 다시 시도는 실제로 보낸다. 사진·경로 요청에는 적용되지 않는다 |
| 직접 올린 사진의 결과 (Result for uploaded photos) | 보인다. 올린 사진을 환승 안내판 / KTX 맞이방 / 흐린 사진 중 무엇으로 볼지 고른다 | 숨겨진다. 올린 사진은 `POST /sessions/{id}/localizations`로 보내고 결과는 서버 응답을 따른다 |
| 데모 초기화 (Reset demo) | http와 같다(취소 이벤트와 세션 정리를 mock 어댑터가 받는다) | 안내 중이면 `navigation_cancelled`를 보낸 뒤 보관한 세션 토큰을 지우고 처음 화면으로 돌아간다 |

위치 확인 화면의 "또는 데모 사진으로 해보기"(Or try a demo photo) 버튼도 mock 모드에서만 보인다. 데모 사진도 작은 JPEG로 만들어 올린 사진과 같은 압축·업로드 경로로 보낸다. http 모드에서는 사진을 직접 찍거나 올려야 하고, 지금 서버는 사진 인식이 연결되지 않아(`NoVision`) `503`을 돌려주므로 직접 선택 화면으로 이어진다.

## Scenario map

아래 흐름은 mock 모드 기준이다. http 모드에서는 채팅 답변과 추천 칩이 서버(`RuleAgent`) 응답을 따르므로 문구와 단계가 다를 수 있고, 사진 단계의 데모 사진(환승 안내판, KTX 맞이방, 흐린 사진)은 고를 수 없다.

| Flow | Try |
| --- | --- |
| Payment questions | "How do I pay?", "What's a transit card?", "Can I pay with a credit card?" |
| Express | Incheon Airport → Express → photo → B2 counter → how to buy → B7 platform |
| All-stop, no card | All-stop → "I don't have one" → B3 machines (single-journey ticket) |
| All-stop, has card | All-stop → "I have a transit card" → straight to B3 gates → B7 |
| Refusals | "How much is the fare?" → no guessing |
| Recovery | Blurry photo → retake / choose on list; "I'm lost" on the route |
