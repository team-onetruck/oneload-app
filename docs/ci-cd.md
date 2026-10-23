<!--
Date: 2026-10-23
Author: Jung Minkyu
Purpose: 이 레포의 CI와 CD 초안이 언제 무엇을 하는지, 활성화에 필요한 관리자 작업, PR에서 배포까지의 흐름 정리
-->

# CI / CD

CI(지속적 통합)는 "이 변경을 main에 합쳐도 되는가"를 기계가 매번 같은 방법으로 확인하는 일이다.
CD(지속적 배포)는 main에 합쳐진 결과를 사람 손 없이 서버에 올리는 일이다.
이 레포는 CI는 켜져 있고, CD는 초안만 있다.

## 1. 한눈에 보기

| 워크플로 | 파일 | 언제 | 하는 일 | 상태 |
| --- | --- | --- | --- | --- |
| CI | `.github/workflows/ci.yml` | 모든 브랜치 push, 모든 PR | `pnpm verify`, e2e(Playwright 11개) | 동작 중 |
| Deploy | `.github/workflows/deploy.yml` | 지금은 수동 실행만 (`workflow_dispatch`) | main을 검증·빌드해 macserver의 `~/hangil-demo/dist`로 동기화 | 초안. 관리자 설정 후 push 트리거 활성화 |

## 2. CI: `ci.yml`

### 언제 도는가

- 어느 브랜치든 push하면 돈다. 브랜치를 올리자마자 깨졌는지 알 수 있게 하려는 것이다.
- PR을 열거나 갱신해도 돈다. 이때는 PR 브랜치를 main과 합친 결과를 검사하므로, 브랜치에서는 통과해도 main과 합치면 깨지는 경우를 잡는다.
- 그래서 PR이 열린 브랜치에 push하면 같은 job이 두 번(push, pull_request) 돈다. 정상이다.

### verify job

| 단계 | 이유 |
| --- | --- |
| `actions/checkout` + `fetch-depth: 0` | 헤더 검사(`scripts/check-header.mjs`)가 `git diff main...HEAD`로 새 파일을 찾으므로 전체 이력이 필요하다 |
| 로컬 `main` 브랜치 준비 | checkout은 main을 `origin/main`으로만 받아서, 헤더 검사가 쓰는 `main` 이름을 만들어 준다 |
| Node 22 + corepack으로 pnpm 11.13.0 | 로컬과 같은 pnpm 버전을 써야 lockfile 해석이 같다 |
| pnpm store 캐시 | lockfile이 같으면 내려받은 패키지를 다시 쓰므로 설치가 빨라진다 |
| `pnpm install --frozen-lockfile` | lockfile과 `package.json`이 어긋나면 설치를 실패시킨다. "내 컴퓨터에서는 됐는데"를 막는다 |
| `pnpm verify` | 헤더 검사 + oxlint + 타입체크 + 단위 테스트. 로컬에서 커밋 전에 돌리는 것과 같은 명령이다 |

### e2e job

- `pnpm test:e2e`로 11개를 돌린다. `playwright.config.ts`가 개발 서버를 모드마다 하나씩 띄운다.

  | 프로젝트 | 개발 서버 | 테스트 |
  | --- | --- | --- |
  | `mock` | `VITE_API_MODE=mock`, 4179 | `e2e/smoke.spec.ts`(시작 화면, Demo 라벨) 2개, `e2e/mock/` 기준선 5개(서버 없는 데모 흐름, `/api`로 나가는 요청이 없는지) |
  | `http` | `VITE_API_MODE=http`, 4180 | `e2e/scenarios/` 4개(직통열차, 일반열차+카드 없음, 사진 503 → 직접 선택, Live 라벨). `/api/v1`은 `page.route`로 가로채 MSW 핸들러가 답한다 |

  `test:e2e` 스크립트가 없으면 설치와 실행 단계를 건너뛰고 통과로 표시하는 조건은 그대로 남아 있다.
- 브라우저 설치는 캐시를 쓴다. 설치된 `@playwright/test` 버전으로 `~/.cache/ms-playwright`를 캐시하고(키: OS, 아키텍처, Playwright 버전), 버전이 같으면 받는 chromium도 같다.
  - 캐시가 없으면 `pnpm exec playwright install --with-deps chromium`으로 브라우저와 시스템 라이브러리를 함께 받는다.
  - 캐시가 있으면 `pnpm exec playwright install chromium`으로 브라우저만 확인하고 시스템 라이브러리(apt) 설치는 건너뛴다. apt 미러가 느리면 이 단계가 몇 분씩 걸렸기 때문이다. chromium 실행에 필요한 라이브러리는 러너 이미지에 이미 있다.
  - 대가: CJK 폰트가 없어 실패 트레이스 스크린샷의 한국어가 네모로 보인다(스크린샷 비교 테스트는 없다). 러너 이미지가 바뀌어 브라우저가 missing dependencies로 실패하면 install-deps를 되살리거나 캐시 키를 바꾼다.
- 실패하면 `test-results/`(실패한 테스트의 트레이스)를 `e2e-test-results` artifact로 올린다(7일 보관). HTML 리포트는 만들지 않는다.
- verify와 `needs`로 묶지 않았다. 한쪽이 실패해도 다른 쪽 결과를 볼 수 있게 하려는 것이다.

### 검증 범위: 무엇을 증명하고 무엇을 증명하지 않는가

CI의 vitest(MSW 계약 테스트 포함)와 Playwright 스모크는 모두 서버 없이 돈다. vitest는 가짜 fetch와 MSW 핸들러(`src/test/handlers.ts`, 타입은 OpenAPI에서 생성한 `src/api/schema.d.ts`)로 백엔드를 흉내 내어, 클라이언트가 계약대로 요청을 만들고 409·503·타임아웃 같은 응답을 처리하는지 확인한다. Playwright 스모크(`e2e/smoke.spec.ts`, mock 모드 1건)는 앱이 실행되어 시작 화면이 뜨는지만 보고, mock 기준선(`e2e/mock/`, 5건)은 서버 없는 데모 흐름이 그대로이고 서버로 나가는 요청이 없는지 본다. Playwright 시나리오(`e2e/scenarios/`, http 모드 3건)는 실제 화면과 http 어댑터로 채팅 → 사진(또는 503 뒤 직접 선택) → 위치 확정 → 경로 → 길안내 이벤트를 따라가지만, 응답은 같은 MSW 핸들러가 만든다. 그래서 CI가 초록이어도 실서버에서 채팅 → 사진 → 경로 전체 흐름이 동작한다는 증거는 아니다. MSW 핸들러는 우리가 이해한 계약을 흉내 낸 것이라 실제 서버의 답변 문구(`RuleAgent`), 응답 시점, 지도 데이터와 다를 수 있다. 실서버 확인은 각 PR 본문의 브라우저 확인 절(예: #12의 "브라우저(http, 로컬 백엔드)")을 본다.

## 3. CD 초안: `deploy.yml`

### 지금 상태

트리거가 `workflow_dispatch`(수동 실행)뿐이라 이 파일이 main에 머지돼도 아무 일도 일어나지 않는다.
macserver에 이 레포용 runner가 아직 없어서, 자동으로 돌면 배포 job이 runner를 기다리다 실패하기 때문이다.
`push: branches: [main]` 트리거는 주석으로 남겨 두었고, 아래 체크리스트를 마친 뒤 주석을 푼다.

### build job (GitHub 호스트 runner, `ubuntu-latest`)

1. CI와 같은 방법으로 설치하고 `pnpm verify`를 한 번 더 돌린다. CI를 통과한 커밋이라도 배포 직전 상태를 다시 확인한다.
2. `pnpm build`로 `dist/`를 만든다. `VITE_` 환경변수를 넣지 않으므로 API 주소는 기본값(같은 origin의 `/api/v1`)이고, 배포 서버에서는 Caddy가 이 경로를 백엔드로 넘긴다.
3. `dist/`를 artifact로 올린다(7일 보관). 다음 job이 다른 컴퓨터(macserver)에서 받아 가야 하기 때문이다.

빌드를 macserver가 아니라 GitHub 호스트 runner에서 하는 이유: 서버에 Node와 pnpm을 깔 필요가 없고, 서버에서 돌리는 일을 "받아서 복사하기"로 최소화할 수 있다.

### deploy job (macserver의 self-hosted runner)

1. `github.ref`가 main일 때만 돈다. 다른 브랜치에서 수동 실행해도 build까지만 하고 배포는 하지 않는다.
2. `concurrency: deploy-hangil-demo`로 배포를 한 번에 하나만 한다. 앞 배포를 중간에 끊으면 `dist`가 반쯤 바뀐 채 남을 수 있어서 `cancel-in-progress: false`로 기다리게 했다.
3. artifact를 내려받아 `rsync -a --delete dist/ ~/hangil-demo/dist/`를 서버 안에서 실행한다. README의 수동 배포와 같은 명령이고, Caddy(127.0.0.1:4173)가 이 폴더를 그대로 서빙하므로 재시작은 없다.

self-hosted runner를 쓰는 이유: macserver는 Tailscale Funnel로 HTTPS만 공개돼 있어서 GitHub 쪽에서 SSH로 들어갈 길이 없다.
self-hosted runner는 서버에서 GitHub로 나가는 연결로 job을 받아 오므로 서버에 문을 열지 않아도 된다.
oneload-backend도 같은 방식(테스트는 GitHub 호스트, 배포는 macserver runner)으로 배포한다.

### 비밀값

이 초안은 secrets를 쓰지 않는다. 서버 안에서 로컬 rsync만 하고, 빌드에 넣는 비밀값도 없다.
나중에 비밀값이 필요해지면 레포의 Settings → Secrets에 넣고 워크플로에서는 `${{ secrets.이름 }}`으로만 참조한다. 값을 파일에 쓰지 않는다.

## 4. PR → CI → 머지 → 배포 흐름

1. 작업마다 `feat/task-N-...` 브랜치를 만들고, 로컬에서 `pnpm verify`를 통과시킨 커밋만 쌓는다.
2. 브랜치를 push하면 CI가 돈다(push 실행).
3. main을 대상으로 PR을 열면 CI가 main과 합친 결과로 한 번 더 돈다(pull_request 실행).
4. 체크가 모두 초록이고 리뷰가 끝나면 머지한다. 브랜치 보호를 켜면 이 조건을 GitHub가 강제한다.
5. (CD 활성화 후) main에 머지되면 Deploy가 돌아 build → deploy 순으로 macserver에 올라간다.
6. 문제가 생기면 main에서 해당 커밋을 revert하는 PR을 머지한다. CD가 켜져 있으면 이전 상태로 다시 배포된다. 급할 때는 README의 수동 rsync로 직접 덮어쓴다.

## 5. 활성화 체크리스트 (레포 관리자 작업)

- [ ] **runner 등록**: macserver에 이 레포(team-onetruck/oneload-app)용 self-hosted runner를 등록하고 라벨 `self-hosted`, `macOS`, `hangil`을 붙인다. oneload-backend의 runner는 그 레포 전용으로 등록돼 있어 이 레포에서 쓸 수 없다. 조직 runner 그룹으로 옮겨 두 레포가 함께 쓰는 방법도 있다.
- [ ] **runner 버전**: 2.327.1 이상. `actions/download-artifact@v8`이 Node 24로 돌아서 그보다 낮은 runner에서는 실행되지 않는다.
- [ ] **runner 실행 계정**: Caddy가 서빙하는 `~/hangil-demo`의 소유 계정으로 runner를 실행한다. 워크플로는 `$HOME/hangil-demo`가 없으면 배포를 멈춘다.
- [ ] **공개 레포 보안**: 이 레포는 PUBLIC이다. 외부 사람이 포크 PR에 워크플로를 넣으면 self-hosted runner에서 코드를 실행하려 할 수 있다.
  - Settings → Actions → General에서 외부 기여자의 포크 PR 워크플로는 승인 후에만 돌게 한다.
  - 플랜이 지원하면 runner를 조직 runner 그룹에 넣고, 이 레포의 `deploy.yml`(main)만 쓰도록 제한한다.
  - runner 계정에는 `~/hangil-demo`에 쓰는 권한 이상을 주지 않는다.
- [ ] **브랜치 보호(main)**: PR을 거쳐야만 머지, 상태 체크 `verify` 통과 필수, 강제 push 금지.
- [ ] **(선택) 배포 승인**: Environment `production`을 만들고 승인자를 지정한 뒤 deploy job에 `environment: production`을 추가하면 배포 전에 사람이 확인한다.
- [ ] **수동 첫 배포**: 위 작업 후 `gh workflow run deploy.yml --ref main`으로 한 번 돌려 결과를 확인한다.
- [ ] **자동 배포 켜기**: `deploy.yml`의 `push` 트리거 주석을 푸는 PR을 머지한다.
