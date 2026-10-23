# 한길 (Hangil) web prototype

Clickable, phone-sized prototype of the Hangil demo client for the Seoul Station / AREX scenario: a foreign visitor who doesn't know how tickets, transit cards and cash work, gets to the right ticket point and platform.

**Prototype only.** All replies, photo recognition and routes are in-memory mocks shaped like the backend contracts (`/api/v1` messages, localizations, routes). Nothing calls a server yet.

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
| `http` (기본) | 시작 화면에서 `POST /api/v1/sessions`로 세션을 만들고, 채팅은 `POST /sessions/{id}/messages` 응답으로 동작한다 |
| `mock` | 서버 없이 기존 데모 규칙(`assistant.ts`, `route.ts`)으로 동작한다 |

개발 서버는 `/api`를 `VITE_API_PROXY_TARGET`(기본 `http://127.0.0.1:8000`)으로 프록시한다. 배포처럼 같은 origin이라 CORS 설정이 필요 없다.

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

## Scenario map

| Flow | Try |
| --- | --- |
| Payment questions | "How do I pay?", "What's a transit card?", "Can I pay with a credit card?" |
| Express | Incheon Airport → Express → photo → B2 counter → how to buy → B7 platform |
| All-stop, no card | All-stop → "I don't have one" → B3 machines (single-journey ticket) |
| All-stop, has card | All-stop → "I have a transit card" → straight to B3 gates → B7 |
| Refusals | "How much is the fare?" → no guessing |
| Recovery | Blurry photo → retake / choose on list; "I'm lost" on the route |
