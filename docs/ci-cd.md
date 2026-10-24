<!--
Date: 2026-10-23
Author: Jung Minkyu
Purpose: 이 레포의 CI와 배포가 언제 무엇을 하는지, 필요한 관리자 설정, PR에서 배포까지의 흐름 정리
-->

# CI / CD

CI(지속적 통합)는 "이 변경을 main에 합쳐도 되는가"를 기계가 매번 같은 방법으로 확인하는 일이다.
CD(지속적 배포)는 main에 합쳐진 결과를 사람 손 없이 서버에 올리는 일이다.
이 레포는 CI를 직접 돌리고, main이 통과하면 이 레포 전용 self-hosted runner로 macserver에 배포한다.

## 1. 한눈에 보기

| 워크플로 | 파일 | 언제 | 하는 일 | 상태 |
| --- | --- | --- | --- | --- |
| CI | `.github/workflows/ci.yml` | 모든 브랜치 push, 모든 PR | `pnpm verify`, e2e(Playwright) | 동작 중 |
| Deploy | `.github/workflows/ci.yml`의 `deploy` job | main push에서 verify·e2e 통과 후 | oneload-infra의 공용 배포를 이 레포 전용 runner(macserver)에서 돌려 웹 이미지를 새로 올린다 | 동작 중 |

## 2. CI: `ci.yml`

### 언제 도는가

- 어느 브랜치든 push하면 돈다. 브랜치를 올리자마자 깨졌는지 알 수 있게 하려는 것이다.
- PR을 열거나 갱신해도 돈다. 이때는 PR 브랜치를 main과 합친 결과를 검사하므로, 브랜치에서는 통과해도 main과 합치면 깨지는 경우를 잡는다.
- 그래서 PR이 열린 브랜치에 push하면 같은 job이 두 번(push, pull_request) 돈다. 정상이다.

### verify job

| 단계 | 이유 |
| --- | --- |
| `actions/checkout` | 검증할 커밋의 소스를 가져온다 |
| Node 22 + corepack으로 pnpm 11.13.0 | 로컬과 같은 pnpm 버전을 써야 lockfile 해석이 같다 |
| pnpm store 캐시 | lockfile이 같으면 내려받은 패키지를 다시 쓰므로 설치가 빨라진다 |
| `pnpm install --frozen-lockfile` | lockfile과 `package.json`이 어긋나면 설치를 실패시킨다. "내 컴퓨터에서는 됐는데"를 막는다 |
| `pnpm verify` | oxlint + 타입체크 + 단위 테스트. 로컬에서 커밋 전에 돌리는 것과 같은 명령이다 |

### e2e job

- `pnpm test:e2e`로 서버 연결 앱을 검증한다. `playwright.config.ts`는 개발 서버 하나(4180)를 띄운다.
  - `http`: 모바일 크롬에서 시작 화면, 직통열차·일반열차·사진 503 시나리오, 카메라 안내와 예전 데모 진입 차단을 검증한다.
  - `desktop`: 한국어·영어로 `/`, `/?demo`, `/?demo&mode=mock`에 접속해도 데모 도구와 모드 배지가 없고 서버 세션을 생성하는지 검증한다.
  - 서버에는 예전 `VITE_API_MODE=mock`을 의도적으로 설정한다. 앱이 이 값을 무시하고 HTTP 요청을 보내야 통과한다.
  - 데모 전용 E2E는 제거했다. 카메라 E2E는 HTTP 어댑터와 MSW 응답을 쓰도록 옮겼다.

  `test:e2e` 스크립트가 없으면 설치와 실행 단계를 건너뛰고 통과로 표시하는 조건은 그대로 남아 있다.
- 브라우저 설치는 캐시를 쓴다. 설치된 `@playwright/test` 버전으로 `~/.cache/ms-playwright`를 캐시하고(키: OS, 아키텍처, Playwright 버전), 버전이 같으면 받는 chromium도 같다.
  - 캐시가 없으면 `pnpm exec playwright install --with-deps chromium`으로 브라우저와 시스템 라이브러리를 함께 받는다.
  - 캐시가 있으면 `pnpm exec playwright install chromium`으로 브라우저만 확인하고 시스템 라이브러리(apt) 설치는 건너뛴다. apt 미러가 느리면 이 단계가 몇 분씩 걸렸기 때문이다. chromium 실행에 필요한 라이브러리는 러너 이미지에 이미 있다.
  - 대가: CJK 폰트가 없어 실패 트레이스 스크린샷의 한국어가 네모로 보인다(스크린샷 비교 테스트는 없다). 러너 이미지가 바뀌어 브라우저가 missing dependencies로 실패하면 install-deps를 되살리거나 캐시 키를 바꾼다.
- 실패하면 `test-results/`(실패한 테스트의 트레이스)를 `e2e-test-results` artifact로 올린다(7일 보관). HTML 리포트는 만들지 않는다.
- verify와 `needs`로 묶지 않았다. 한쪽이 실패해도 다른 쪽 결과를 볼 수 있게 하려는 것이다.

### 검증 범위: 무엇을 증명하고 무엇을 증명하지 않는가

CI의 vitest와 Playwright는 실제 백엔드 없이 돈다. vitest는 가짜 fetch와 MSW로 요청 계약과 오류 복구를 검증한다. Playwright는 실제 화면과 HTTP 어댑터를 사용하지만 `/api/v1` 응답은 `page.route`가 MSW 핸들러로 재현한다. 시작 화면, 예전 데모 진입 차단, 채팅 → 사진(또는 503 뒤 직접 선택) → 위치 확정 → 경로 → 안내 이벤트, 카메라 안내를 검증한다. 따라서 테스트 통과가 실제 백엔드의 가동 상태나 AI 응답 품질을 보증하지는 않는다.

## 3. CD: 이 레포의 runner에서 공용 배포를 돈다

### 흐름

1. main에 push되면 `ci.yml`의 `deploy` job이 verify와 e2e가 모두 통과한 뒤에만 돈다.
2. 이 job은 oneload-infra의 공용 배포 워크플로(`.github/workflows/deploy.yml`)를 부른다. 그 job은 **이 레포 전용 self-hosted runner `macserver-hangil-app`**(macserver)에서 돈다.
3. 공용 배포는 모든 레포의 main(backend, oneload_agent, oneload-data, 이 레포, oneload-infra)을 checkout하고 `deploy.sh`를 돌린다. 이 레포는 `web.Dockerfile`로 웹 이미지 `hangil-web`이 된다. 이미지 안에서 `pnpm install --frozen-lockfile`과 `pnpm build`를 하고, 결과(`dist/`)를 Caddy 이미지에 넣는다.
4. compose 프로젝트 `hangil`의 `caddy` 서비스가 새 이미지로 바뀐다. Portainer에서도 보인다.

`VITE_` 환경변수를 넣지 않으므로 API 주소는 기본값(같은 origin의 `/api/v1`)이고, Caddy가 이 경로를 백엔드로 넘긴다.

### 왜 이렇게 하나

- **서버는 GitHub로 나가는 연결만 쓴다.** macserver는 Tailscale Funnel로 HTTPS만 공개돼 있어 GitHub에서 SSH로 들어갈 길이 없다. runner가 job을 받아 오는 방식이라 서버에 문을 열지 않아도 된다.
- **배포 정의는 oneload-infra 한 곳에 있다.** backend, 이 레포, oneload_agent가 같은 배포를 부르므로, 어느 레포가 바뀌어도 서버에는 언제나 모든 레포의 main이 올라간다. 배포 세 개가 겹치면 서버에서 하나씩 차례로 돈다.
- **배포는 항상 소스에서 빌드한다.** 서버에 Node를 깔 필요가 없고(빌드는 컨테이너 안에서), lockfile이 그대로면 설치 단계는 Docker 캐시를 쓴다.
- **위험**: 이 레포는 공개이고 서버 runner가 붙어 있다. 포크 PR이 워크플로를 바꿔 서버에서 코드를 실행할 수 있으므로, 포크 PR 워크플로는 관리자 승인 후에만 돌게 해 두었다(5장).

### 비밀값

쓰지 않는다. 서버 설정(`OPENAI_API_KEY` 등)은 oneload-backend의 secrets에만 있고, 이 레포에서 시작한 배포는 서버 설정을 건드리지 않는다.

## 4. PR → CI → 머지 → 배포 흐름

1. 작업마다 `feat/task-N-...` 브랜치를 만들고, 로컬에서 `pnpm verify`를 통과시킨 커밋만 쌓는다.
2. 브랜치를 push하면 CI가 돈다(push 실행).
3. main을 대상으로 PR을 열면 CI가 main과 합친 결과로 한 번 더 돈다(pull_request 실행).
4. 체크가 모두 초록이고 리뷰가 끝나면 머지한다. 브랜치 보호를 켜면 이 조건을 GitHub가 강제한다.
5. main에 머지되면 CI의 deploy job이 이 레포의 runner에서 공용 배포를 돌려 macserver에 웹 이미지를 새로 올린다.
6. 문제가 생기면 main에서 해당 커밋을 revert하는 PR을 머지한다. 이전 상태로 다시 배포된다.

## 5. 관리자 설정

- [x] **runner 등록**: macserver에 이 레포 전용 self-hosted runner `macserver-hangil-app`(라벨 `self-hosted`, `macOS`, `hangil`)을 `~/actions-runner-hangil-app`에 설치했다. Caddy와 Docker를 쓰는 같은 계정으로 돈다.
- [x] **포크 PR 승인**: Settings → Actions → General에서 외부 기여자 전원의 포크 PR 워크플로가 승인 후에만 돈다(`all_external_contributors`). 공개 레포에 서버 runner가 붙어 있으므로 **`.github/`를 건드리는 포크 PR 실행은 절대 승인하지 않는다.**
- [ ] **브랜치 보호(main)**: PR을 거쳐야만 머지, 상태 체크 `verify` 통과 필수, 강제 push 금지.
