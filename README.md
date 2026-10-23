# 한길 (Hangil) web prototype

Clickable, phone-sized prototype of the Hangil demo client for the Seoul Station / AREX scenario: a foreign visitor who doesn't know how tickets, transit cards and cash work, gets to the right ticket point and platform.

**연결 상태 (2026-10-23, #12 기준).** `VITE_API_MODE`로 mock 모드와 http 모드를 고른다. mock 모드는 서버를 부르지 않고 브라우저 안의 데모 규칙으로 동작한다. http 모드(기본)에서는 세션 생성, 채팅, 언어 전환이 서버로 동작하고, 사진 위치 인식·위치 확정·경로 안내는 아직 브라우저 안의 데모 데이터로 동작한다(작업 3·4에서 연결 중이며, 머지 후 이 문장을 갱신한다). 기능별 상태는 [백엔드 연결](#백엔드-연결-vite_api_mode) 표를 본다.

- Floors of AREX ticket points (B2 express, B3 all-stop) and platforms (B7) follow the [AREX official guide](https://www.airportrailroad.com/co/steUsfGud.do), checked 2026-10-22.
- Passages, distances, sign wording and "demo doc" sources are placeholders until the field survey.

## Street view

The route screen has a **Line / Street view** toggle. Street view shows a 360° photo of the current point with a floor arrow toward the next one; **Next** steps to the next photo.

- Each node stores one panorama and `northYaw` (where map north sits in the photo). The arrow angle is `northYaw + leg heading`, so no per-route arrow data is stored.
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
| `mock` | 서버를 부르지 않는다. 가짜 세션(`src/features/session/mockSession.ts`), 키워드 규칙(`assistant.ts`), 경로 탐색(`route.ts`)으로 동작한다 |

http 모드의 기능별 상태 (`src/store.tsx` 기준):

| 기능 | 상태 | 호출과 동작 |
| --- | --- | --- |
| 세션 시작 ("Start") | 서버 연결됨 | `POST /sessions` |
| 채팅 (입력, 칩, 추천 답변) | 서버 연결됨 | `POST /sessions/{id}/messages`. 답변·목록·출처와 `unverified_notes`("Not verified", 한국어 화면은 "확인되지 않음")는 서버 응답을 표시한다. 사진을 붙이면 JPEG 2MB 이하로 줄여 multipart로 보낸다. 지금 단계에서 할 수 없는 요청(`INVALID_STATE`)이면 `GET /sessions/{id}/navigation-state`로 상태를 다시 읽는다 |
| 목적지 목록에서 고르기 | 서버 연결됨 | 목록은 앱 데이터(`data.ts`)이고, 고른 목적지는 `selected_poi_id`로 `/messages`에 보낸다 |
| "길을 잃었어요" | 서버 연결됨 | 문장을 `/messages`로 보내고 위치 확인 화면으로 넘어간다 |
| 언어 전환 (세션 시작 후) | 서버 연결됨 | `PATCH /sessions/{id}`. `409 REVISION_CONFLICT`면 navigation-state로 맞춘 뒤 한 번 다시 보낸다. 세션 전에는 화면 언어만 바꾼다 |
| 사진으로 위치 찾기 | 로컬 (연결 진행 중, 작업 3) | 데모 패널에서 고른 결과(`data.ts`의 `SCENARIOS`)를 보여 준다. `/localizations`를 부르지 않는다 |
| 위치 확정 | 로컬 (연결 진행 중, 작업 3) | 화면 상태만 바꾼다. `/location-confirmations`를 부르지 않는다 |
| 경로 안내 | 로컬 (연결 진행 중, 작업 4) | `route.ts`가 `data.ts`의 통로로 계산한다. `/routes`를 부르지 않는다 |
| 안내 시작·도착 | 로컬 (연결 진행 중, 작업 4) | `/navigation-events`를 보내지 않는다 |
| 처음으로 (초기화) | 로컬 | 보관한 세션 토큰만 지운다. 서버 세션은 2시간 동안 요청이 없으면 만료된다 |

http 모드에서 위치·경로 단계는 서버에 알리지 않으므로 서버 세션 상태(데모 패널의 state·rev)도 바뀌지 않는다.
`src/features/localization`, `src/features/route`에는 사진·확정·경로·이벤트용 요청 함수가 있지만 아직 화면에서 쓰지 않는다.

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

## Deploy (macserver)

`dist/` is synced to `macserver:~/hangil-demo/dist`. Caddy on `127.0.0.1:4173` serves it (zstd/gzip, immutable cache for `/assets`), proxies `/api/*` to the backend and serves `/panos/*` from [oneload-data](https://github.com/team-onetruck/oneload-data); Tailscale Funnel exposes all of it at `https://baki-macbookpro.tail3286a4.ts.net:10000/`. The server setup lives in [oneload-infra](https://github.com/team-onetruck/oneload-infra).

```sh
pnpm build && rsync -a --delete dist/ macserver:~/hangil-demo/dist/
```

## Demo controls

The **Demo** pill (top of the desktop frame; on phones open the URL with `?demo` to get a slim tab on the right edge) shows the session state machine and lets you:

- make the next AI request time out (error + retry path),
- choose what an uploaded photo resolves to (match / KTX hall / no match),
- reset the demo.

http 모드에서 "다음 AI 요청 실패시키기"(Next AI request times out)는 첫 `/messages` 요청을 보내지 않고 타임아웃으로 처리하며, 다시 시도는 실제로 보낸다. 사진 결과 선택은 사진 위치 인식이 아직 로컬이라 두 모드 모두에 적용된다.

## Scenario map

아래 흐름은 mock 모드 기준이다. http 모드에서는 채팅 답변과 추천 칩이 서버(`RuleAgent`) 응답을 따르므로 문구와 단계가 다를 수 있다.

| Flow | Try |
| --- | --- |
| Payment questions | "How do I pay?", "What's a transit card?", "Can I pay with a credit card?" |
| Express | Incheon Airport → Express → photo → B2 counter → how to buy → B7 platform |
| All-stop, no card | All-stop → "I don't have one" → B3 machines (single-journey ticket) |
| All-stop, has card | All-stop → "I have a transit card" → straight to B3 gates → B7 |
| Refusals | "How much is the fare?" → no guessing |
| Recovery | Blurry photo → retake / choose on list; "I'm lost" on the route |
