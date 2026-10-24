<!--
Date: 2026-10-25
Author: Jung Minkyu
Purpose: 실제 로컬 프론트·백엔드·DB 연동 결과, 화면 증거와 권한 제한 및 배포 절차를 기록한다
-->

# 로컬 실제 연동 확인과 배포 상태

2026-10-24 23:59 KST에 실제 로컬 서버로 확인했다. 브라우저의 API 응답을 가로채거나 MSW로 대체하지 않았다. 요청 결과는 [api-summary.json](verification/2026-10-24-local/api-summary.json)에 있으며 토큰과 세션 식별자는 저장하지 않았다.

## 결과

| 확인 항목 | 결과 |
| --- | --- |
| 프론트 | 작업 worktree의 React/Vite 앱, `http://127.0.0.1:5173` |
| 백엔드 | 내려받은 `oneload-backend`, FastAPI/Uvicorn, `127.0.0.1:8000` |
| DB | 분리된 Docker 프로젝트 `oneload-local-review`, PostgreSQL 17, `127.0.0.1:54329`. 마이그레이션 `0003` 적용 |
| 지도 | 옆 폴더 `oneload-data/maps/seoul-station.json`을 실제 백엔드에서 로드 |
| 헬스 체크 | `status=ok`, `dependencies.database=ok` |
| 세션 | `POST /sessions` → 201, `idle`, revision 1 |
| 채팅 | 인천공항 → 직통열차 요청 두 번 모두 200. 목적지 `poi-express-tickets`, revision 3 |
| 사진 | 실제 이미지 파일을 JPEG로 압축·업로드. API가 503 `AI_SERVICE_UNAVAILABLE` 반환. 화면은 직접 위치 선택으로 정상 전환 |
| 위치·경로 | KTX 맞이방 선택 → 확정 200 → 경로 200. 2개 안내 단계, 150m 경로 표시 |
| 안내 이벤트 | 출발·도착 요청 모두 200. 최종 서버 상태 `arrived`, revision 7 |
| 화면 | 예전 `?demo` 주소에서도 데모 패널과 모드 배지 없음. 카메라 탭 이름은 ‘카메라’ |
| 브라우저 오류 | 페이지 JavaScript 오류 0개 |

DB 이미지 다운로드가 느려 이미 설치된 `postgres:17-alpine`을 임시 compose override로 사용했다. 백엔드 저장소의 compose 파일은 수정하지 않았다. 이 확인에서는 pgvector 확장을 사용하는 검색 기능을 실행하지 않았다.

## AI·RAG에 대해 확인된 범위

로컬에 `OPENAI_API_KEY`가 없어 백엔드는 현재 구현대로 `RuleAgent`와 `NoVision`을 선택한다. 이것은 프론트의 종료된 데모 모드와 별개다. 프론트는 실제 서버를 부르고, 서버의 현재 실행 설정이 규칙 기반 답변과 사진 인식 불가 응답을 돌려준다.

따라서 OpenAI 답변 품질과 사진 인식 성공은 확인하지 못했다. 채팅 화면의 출처에 보이는 ‘데모 문서’ 문구도 백엔드가 반환한 기존 지식 자료 제목이다. 프론트에서 출처를 바꾸거나 숨기지 않았다. 백엔드의 OpenAI 경로도 현재 `MockKnowledgeSearch`를 사용하므로 RAG 저장소를 다운로드한 것만으로 별도 RAG 검색 서비스가 자동 연결되지는 않는다.

Windows에서는 기본 CP949 때문에 지도 JSON을 읽지 못해 `PYTHONUTF8=1`로 실행했다. DB 주소도 `localhost` 대신 `127.0.0.1`로 명시했다. 백엔드 소스는 수정하지 않았다.

## 실제 화면

| 시작 화면 | 실제 서버 채팅 |
| --- | --- |
| ![모드 배지 없는 시작 화면](verification/2026-10-24-local/01-start.png) | ![실제 백엔드 채팅 응답](verification/2026-10-24-local/02-chat.png) |

| 사진 업로드 | 사진 인식 불가 후 직접 선택 |
| --- | --- |
| ![데모 사진 버튼 없는 업로드 화면](verification/2026-10-24-local/03-upload.png) | ![실제 503 응답 뒤 위치 선택](verification/2026-10-24-local/04-photo-fallback.png) |

| 실제 서버 경로 | 카메라 안내 |
| --- | --- |
| ![서버 경로로 그린 안내](verification/2026-10-24-local/05-route.png) | ![카메라로 이름이 바뀐 탭](verification/2026-10-24-local/06-camera.png) |

![실제 도착 이벤트 뒤 화면](verification/2026-10-24-local/07-arrived.png)

## 로컬에서 다시 실행하기

아래 명령은 PowerShell 기준이고 세 프로세스를 각각 실행한다. 작업 폴더 `oneload-app-server-only`는 `oneload-backend`, `oneload-data`, `oneload_agent`와 같은 상위 폴더에 있다.

```powershell
# oneload-backend 폴더: 문서의 기본 DB 이미지가 설치된 경우
docker compose -p oneload-local-review up -d --wait
uv sync --frozen
$env:PYTHONUTF8='1'
$env:DATABASE_URL='postgresql+psycopg://hangil:hangil@127.0.0.1:54329/hangil'
$env:PGCONNECT_TIMEOUT='10'
.venv/Scripts/python.exe -X utf8 -m alembic upgrade head
.venv/Scripts/python.exe -X utf8 -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# oneload-app-server-only 폴더의 다른 터미널
pnpm install --frozen-lockfile
pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort

# 같은 프론트 폴더의 또 다른 터미널: 현재의 키 없는 로컬 설정 검증
node scripts/check-local-integration.mjs
```

이번 실행에서는 임시 파일 `C:/Users/Public/Documents/ESTsoft/CreatorTemp/oneload-local-review/postgres.override.yaml`로 DB 이미지만 `postgres:17-alpine`로 바꿨다. 같은 컨테이너를 다시 켤 때는 다음을 사용한다.

```powershell
docker compose -p oneload-local-review -f compose.yaml -f C:/Users/Public/Documents/ESTsoft/CreatorTemp/oneload-local-review/postgres.override.yaml up -d --wait --pull never
```

## Git·CI·배포 상태

- 작업 브랜치: `refactor/server-only-20261024`.
- 별도 worktree: `../oneload-app-server-only`. 원래 공유 폴더의 미커밋 변경은 보존했다.
- 로컬 검증: 작업 worktree에서 프로덕션 빌드, 실제 API 연동 흐름과 Playwright 20개 통과. 단위 테스트는 [서버 연결 단일화 문서](server-only.md)의 Node 환경 설정을 적용하면 445개 통과.
- 연결된 GitHub 계정: `JungMK0720`. 조직 저장소 `team-onetruck/oneload-app` 쓰기 권한 검사에서 403 반환.
- PR·새 원격 CI·merge·배포는 진행하지 못했다. 통합 브랜치에 직접 커밋하거나 푸시하지 않는다.
- 운영 주소 `https://baki-macbookpro.tail3286a4.ts.net:10000`은 이 PC에서 DNS 해석에 실패했다. 로컬 성공을 운영 배포 성공으로 간주하지 않는다.

쓰기 권한이 있는 계정에서 아래 순서로 진행한다.

1. 작업 worktree에서 `git push -u origin refactor/server-only-20261024`.
2. [작업 브랜치 → main PR](https://github.com/team-onetruck/oneload-app/compare/main...refactor/server-only-20261024?expand=1)을 생성한다.
3. PR의 `verify`, `e2e` 필수 검사가 모두 통과한 뒤 merge한다. 실패·대기 중에는 merge하지 않는다.
4. merge 후 [Actions](https://github.com/team-onetruck/oneload-app/actions)의 main CI와 `deploy` 결과를 확인한다.
5. 기존 설정대로 macserver의 self-hosted runner가 공용 배포를 실행한다. 프론트를 빌드하고 Caddy 컨테이너를 교체한다. API 주소는 같은 origin의 `/api/v1`이다.

서버 담당자는 필요하면 `~/hangil`에서 `docker compose ps`와 API 로그를 확인하고, Caddy가 새 웹 이미지를 사용하는지 및 운영 주소의 DNS/Tailscale Funnel 상태를 함께 점검한다.

## 팀에 전달할 문장

> 프론트의 데모 진입과 모드 배지를 제거하고 서버 연결로 통일했습니다. 실제 로컬 프론트–FastAPI–PostgreSQL 연결에서 채팅, 위치 확정, 경로, 도착까지 확인했습니다. 로컬 AI 키가 없어 사진 인식은 수동 선택으로 전환되며, LLM·RAG 품질은 별도 확인이 필요합니다. 작업 브랜치에서 검증과 커밋을 진행했고 현재 GitHub 계정의 조직 쓰기 권한이 없어 원격 반영은 보류됐습니다. 권한 있는 계정에서 브랜치 푸시와 PR을 만든 뒤 필수 CI를 통과하고 merge하면 기존 자동 배포가 실행됩니다.
