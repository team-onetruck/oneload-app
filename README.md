# 한길 (Hangil) web

Phone-sized Hangil web client for the Seoul Station / AREX scenario: a foreign visitor who doesn't know how tickets, transit cards and cash work, gets to the right ticket point and platform.

**연결 상태 (2026-10-24).** 앱은 항상 실제 백엔드 `/api/v1`을 호출한다. 데모 버전과 모드 배지, 개발자 설정 패널은 제거했다. 예전 `?demo` 주소와 `VITE_API_MODE=mock` 설정도 데모를 켜지 않는다. 변경 이유와 파일별 설명은 [서버 연결 단일화](docs/server-only.md)를 본다.

실제 로컬 프론트·백엔드·DB 연결 결과와 화면 7장, 재실행·배포 절차는 [로컬 연동 확인 보고](docs/local-integration-review.md)를 본다.

- Floors of AREX ticket points (B2 express, B3 all-stop) and platforms (B7) follow the [AREX official guide](https://www.airportrailroad.com/co/steUsfGud.do), checked 2026-10-22.
- Passages, distances, sign wording and sample sources are placeholders until the field survey.

## Street view

The route screen has a **Line / Street view** toggle. Street view shows a 360° photo of the current point with a floor arrow toward the next one; **Next** steps to the next photo.

- Each node stores one panorama and `northYaw` (where map north sits in the photo). The arrow angle is `northYaw + leg heading`, so no per-route arrow data is stored.
- http 모드는 서버 경로 단계의 `arrow_yaw_deg`(서버가 사진의 북쪽 + 통로 방향으로 계산)를 그대로 쓰고, 사진 주소는 `pano_id`로 `GET /maps/{id}/graph`의 `image_url`을 찾는다. 서버 값이 없을 때만 그래프의 `north_yaw_deg + heading_deg`로 계산한다. 서버 사진은 예시 여부(`is_example`)만 있어서 "예시 사진 · 서울역 아님" 공통 문구를 붙인다.
- The photos in `public/panos/` are **CC0 samples of other stations** from [Poly Haven](https://polyhaven.com) (Hamburg Hbf, a subway passage, Amsterdam Noord and Vijzelgracht), labelled "Example photo" on screen. Replace them with the Seoul Station field shoot; faces must be blurred before publishing.
- Points without a photo show a "no photo yet" panel; ticket counters and machines have none yet.

## 카메라 안내 (camera + direction arrow)

경로 화면의 **Line / Street view / Camera**(노선 보기 / 거리뷰 / 카메라) 탭 중 카메라는 후면 카메라 영상 위에 다음 지점이 있는 방향을 화살표로 얹는다. 카메라는 "카메라 켜기"를 누른 뒤에만 켜지고, 영상은 폰 안에서만 쓰며 서버로 보내지 않는다. 다른 탭으로 가면 카메라가 꺼진다.

- **위치는 실시간이 아니다.** 실내에는 GPS가 없어서 위치는 사용자가 확정한 지점(노드)뿐이다. 화면 위 칩은 "위치 확인됨"(경로 시작) 또는 "'다음'으로 옮긴 위치"를 보여 준다. 실시간인 것은 방향뿐이다.
- 화살표 각도는 `통로의 지도 방위(Edge.heading_deg, GuideLeg.headingDeg) − 폰이 향한 방위`다. iOS는 `webkitCompassHeading`, Android는 `deviceorientationabsolute`를 방위로 바꾼다(`src/features/live/heading.ts`, `sensors.ts`).
- 방향이 불안정하거나(흔들림·기기 정확도), 센서가 없거나, 권한을 거절했거나, 그 구간의 방위가 없으면 화살표를 숨기고 이유와 "아래 안내를 따르라"를 보여 준다. 카메라를 못 쓰면 노선 보기로 돌아가는 버튼을 준다.
- 안정 판정 숫자와 방향 힌트 경계는 가정이다. 서울역 실측([docs/phase0-compass-field-test.md](docs/phase0-compass-field-test.md)) 전에는 화살표를 "방향 참고용"으로만 쓴다. 센서 수치를 노출하던 데모 확인용 줄은 제거했다.
- iOS Safari의 `webkitCompassHeading`이 폰을 세워 든 자세에서도 카메라 방향을 주는지는 실기기로 아직 확인하지 않았다.

## Run

```sh
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # static files in dist/
```

Desktop shows a 390×844 phone frame; on a phone it fills the screen.

### 백엔드 연결

앱은 `src/api/index.ts`에서 HTTP 어댑터만 생성한다. 환경변수나 주소로 응답을 데모 데이터로 바꿀 수 없다.

| 기능 | 상태 | 호출과 동작 |
| --- | --- | --- |
| 세션 시작 ("Start") | 서버 연결됨 | `POST /sessions` |
| 채팅 (입력, 칩, 추천 답변) | 서버 연결됨 | `POST /sessions/{id}/messages`. 답변·목록·출처와 `unverified_notes`("Not verified", 한국어 화면은 "확인되지 않음")는 서버 응답을 표시한다. 사진을 붙이면 JPEG 2MB 이하로 줄여 multipart로 보낸다. 지금 단계에서 할 수 없는 요청(`INVALID_STATE`)이면 `GET /sessions/{id}/navigation-state`로 상태를 다시 읽는다 |
| 목적지 목록에서 고르기 | 서버 연결됨 | 목록은 `GET /maps/{id}/pois`를 지도마다 한 번 받아 이름(한·영), 분류, 열차, 층을 보여 주고, `verified: false`면 "확인되지 않음"을 붙인다(지금 서버는 확인된 장소만 돌려준다). 고른 서버 `poi_id`를 그대로 `selected_poi_id`로 `/messages`에 보낸다 |
| "길을 잃었어요" | 서버 연결됨 | 문장을 `/messages`로 보내고(서버는 확정 위치만 지우고 목적지·경로는 남긴다) 위치 확인 화면으로 넘어간다. 위치를 다시 확정하면 `GET /sessions/{id}/navigation-state`로 확인한 뒤 같은 목적지를 `reroute: true`로 다시 계산한다 |
| 언어 전환 (세션 시작 후) | 서버 연결됨 | 왼쪽 위 햄버거 메뉴의 언어 목록에서 바꾼다. 시작 언어는 기기 언어를 따른다. `PATCH /sessions/{id}`, `409 REVISION_CONFLICT`면 navigation-state로 맞춘 뒤 한 번 다시 보낸다 |
| 사진으로 위치 찾기 | 서버 연결됨 | JPEG 2MB 이하로 줄여 `POST /sessions/{id}/localizations`로 보낸다. 후보는 근거와 함께 보여 주고 저절로 확정하지 않는다. 후보가 없으면 서버의 `retake_hint`를, `503 AI_SERVICE_UNAVAILABLE`(지금 서버의 `NoVision`)이면 직접 선택 화면을 보여 준다. 데모 사진 선택은 제공하지 않는다 |
| 위치 확정 | 서버 연결됨 | 사용자가 누른 후보(`photo_candidate`)나 목록 항목(`manual`)만 `POST /sessions/{id}/location-confirmations`로 보낸다. `409 REVISION_CONFLICT`면 navigation-state로 맞춘 뒤 한 번 다시 보낸다. 직접 선택 목록은 `GET /maps/{id}/graph`의 노드 전체다 |
| 경로 안내 | 서버 연결됨 | 위치 확정 뒤(또는 "길안내 시작") `POST /sessions/{id}/routes`. 단계의 문구·거리·사진(`pano_id`)·화살표(`arrow_yaw_deg`)는 서버 값을 쓰고, 노드 이름과 사진 주소는 `GET /maps/{id}/graph`에서 찾는다. `409 REVISION_CONFLICT`면 navigation-state로 맞춘 뒤 한 번 다시 보낸다. 등록된 경로가 없으면(`ROUTE_NOT_FOUND`) 경로를 지어내지 않고 안내만 보여 준다 |
| 안내 시작·도착·취소 | 서버 연결됨 | `POST /sessions/{id}/navigation-events`. 경로를 받으면 `navigation_started`, 마지막 단계를 넘기면 `arrived`, 안내 중 처음으로 가면 `navigation_cancelled`를 보낸다. 실패해도 안내는 막지 않고, 같은 `Idempotency-Key`로 한 번 다시 보낸 뒤 남은 이벤트는 다음 이벤트와 함께 보낸다 |
| 처음으로 (초기화) | 로컬 (취소 이벤트만 서버로) | 안내 중이면 `navigation_cancelled`를 보낸 뒤 보관한 세션 토큰을 지운다. 서버 세션은 2시간 동안 요청이 없으면 만료된다 |

'다음' 버튼은 화면의 단계만 넘기고 서버를 부르지 않는다. 서버 세션의 `state`·`revision`은 경로와 안내 이벤트 응답으로 바뀐다.
목적지는 서버 `poi_id` 하나로 다룬다. 도착 화면의 "표 사는 법" 버튼은 목적지 POI의 `category`가 `tickets`인지로 정한다.

| 환경변수 | 기본값 | 쓰는 곳 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` | `src/api/client.ts`. 앱이 부르는 API 주소 |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:8000` | `vite.config.ts`. 개발 서버가 `/api`를 넘길 곳 |

개발 서버는 `/api`를 `VITE_API_PROXY_TARGET`으로 프록시한다. 배포처럼 같은 origin이라 CORS 설정이 필요 없다.

```sh
pnpm dev                                                                  # 로컬 백엔드 (../backend README의 Run locally)
VITE_API_PROXY_TARGET=https://baki-macbookpro.tail3286a4.ts.net:10000 pnpm dev   # 배포 서버
```

### 테스트

```sh
pnpm verify   # oxlint + 타입체크 + vitest
pnpm e2e      # Playwright: 서버 연결 화면, 예전 데모 진입 차단, 카메라 안내
pnpm build    # 프로덕션 빌드
```

Playwright는 개발 서버 하나(4180)를 쓰고, 모바일 `http` 프로젝트에서 시작 화면·서버 연동 시나리오·카메라 안내를 검증한다. `desktop` 프로젝트는 같은 진입 검사를 데스크톱 크기로 반복한다. 한국어·영어에서 `/`, `/?demo`, `/?demo&mode=mock`으로 접속해도 배지와 데모 도구가 없고 `POST /sessions`가 나가는지 확인한다. 테스트 서버에는 의도적으로 예전 `VITE_API_MODE=mock` 설정을 넣어 그 값이 무시되는지도 확인한다.

서버 없는 데모 전용 E2E는 제거했고, 카메라 E2E는 HTTP 어댑터를 쓰도록 옮겼다. `src/api/mockAdapter.ts`는 기존 단위 테스트용으로만 남으며 앱의 API 진입점에서 가져오지 않는다.

E2E의 `/api/v1` 응답은 `page.route`와 MSW 핸들러로 재현한다. 실제 백엔드의 가동 상태와 AI 응답 품질은 별도로 확인해야 한다. 자세한 범위는 [CI/CD 문서](docs/ci-cd.md)를 본다.

## Deploy (macserver)

Merging to `main` deploys automatically: once CI passes, its `deploy` job runs oneload-infra's shared deploy on this repo's own self-hosted runner on macserver, which builds `main` into the `hangil-web` image (see [docs/ci-cd.md](docs/ci-cd.md)). Caddy in that image serves the build (zstd/gzip, immutable cache for `/assets`), proxies `/api/*` to the backend and serves `/panos/*` from [oneload-data](https://github.com/team-onetruck/oneload-data); Tailscale Funnel exposes all of it at `https://baki-macbookpro.tail3286a4.ts.net:10000/`. The server setup lives in [oneload-infra](https://github.com/team-onetruck/oneload-infra).

Redeploy the current `main` by hand: `gh workflow run ci.yml -R team-onetruck/oneload-backend`.

## 사용자 화면

접속하면 한길 시작 화면이 바로 열린다. `Demo`, `Live`, `실서버` 배지나 모드 선택은 없다. 시작하기를 누르면 서버 세션을 만들고, 채팅·사진 업로드·위치 확정·경로 안내를 기존 서버 API로 처리한다. `?demo`가 붙은 예전 링크도 같은 화면으로 열린다.

위치 확인은 직접 찍거나 올린 사진을 사용한다. 인식 API가 `503 AI_SERVICE_UNAVAILABLE`을 반환하면 기존처럼 직접 선택 화면으로 이어진다. 서버 연결에 실패하면 오류와 다시 시도를 보여 주며 데모 응답으로 전환하지 않는다. 처음으로 돌아가기와 언어 설정은 왼쪽 위 메뉴에서 사용한다.
