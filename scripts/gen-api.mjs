/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 백엔드 OpenAPI 문서로 src/api/schema.d.ts 타입을 생성한다 (pnpm gen:api)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import openapiTS, { astToString } from 'openapi-typescript'

const 앱_경로 = fileURLToPath(new URL('..', import.meta.url))
const 출력_파일 = resolve(앱_경로, 'src/api/schema.d.ts')
const 서버_주소 = process.env.API_URL ?? 'http://127.0.0.1:8000'
const 백엔드_경로 = resolve(앱_경로, process.env.BACKEND_DIR ?? '../backend')

// 실행 중인 서버의 문서를 먼저 쓴다. 백엔드는 /api/v1/openapi.json에서 문서를 내준다 (backend/app/main.py).
async function 서버에서_읽기() {
  const 응답 = await fetch(`${서버_주소}/api/v1/openapi.json`, { signal: AbortSignal.timeout(5000) })
  if (!응답.ok) throw new Error(`HTTP ${응답.status}`)
  return 응답.json()
}

// 서버가 꺼져 있으면 ../backend 코드에서 같은 문서를 만든다.
// 가상환경은 node_modules/.cache에 두고 바이트코드도 쓰지 않아 백엔드 폴더에는 아무것도 남기지 않는다.
function 백엔드_코드에서_읽기() {
  const 출력 = execFileSync(
    'uv',
    ['run', '--project', 백엔드_경로, '--frozen', '--no-dev', '--quiet', 'python', '-c',
      'import json; from app.main import app; print(json.dumps(app.openapi(), ensure_ascii=False))'],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        PYTHONPATH: 백엔드_경로,
        PYTHONDONTWRITEBYTECODE: '1',
        UV_PROJECT_ENVIRONMENT: resolve(앱_경로, 'node_modules/.cache/oneload-backend-venv'),
      },
    },
  )
  return JSON.parse(출력)
}

let 문서
try {
  문서 = await 서버에서_읽기()
  console.log(`OpenAPI 출처: 서버 ${서버_주소}`)
} catch (오류) {
  console.warn(`서버 ${서버_주소}에서 읽지 못함 (${오류.message}). ${백엔드_경로} 코드에서 생성합니다.`)
  문서 = 백엔드_코드에서_읽기()
  console.log(`OpenAPI 출처: 백엔드 코드 ${백엔드_경로}`)
}

// 다시 생성해도 스키마가 같으면 diff가 없도록 헤더 날짜는 처음 만든 날을 유지한다.
const 기존_날짜 = existsSync(출력_파일) ? readFileSync(출력_파일, 'utf8').match(/Date: (\d{4}-\d{2}-\d{2})/)?.[1] : undefined
const 날짜 = 기존_날짜 ?? new Date().toLocaleDateString('sv-SE')
const 머리말 = `/**
 * Date: ${날짜}
 * Author: Jung Minkyu
 * Purpose: 백엔드 OpenAPI 문서에서 생성한 API 타입. 직접 고치지 말고 \`pnpm gen:api\`로 다시 만든다.
 */

`

const 본문 = astToString(await openapiTS(문서))
writeFileSync(출력_파일, 머리말 + 본문)
console.log(`생성 완료: src/api/schema.d.ts (${문서.info.title} ${문서.info.version})`)
