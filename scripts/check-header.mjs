/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: 새로 추가된 파일에 Date/Author/Purpose 헤더가 있는지 검사하는 verify 단계
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const 검사_확장자 = /\.(ts|tsx|mjs|md)$/
const 기준_브랜치 = 'main'

const git = (명령) => execSync(`git ${명령}`, { encoding: 'utf8' }).split('\n').filter(Boolean)

// 브랜치에서 추가된 파일 + 스테이징된 신규 파일 + 아직 추적되지 않는 파일
const 신규_파일 = new Set([
  ...git(`diff --name-only --diff-filter=A ${기준_브랜치}...HEAD`),
  ...git('diff --name-only --diff-filter=A --cached'),
  ...git('ls-files --others --exclude-standard'),
])

const 누락 = []
for (const 파일 of 신규_파일) {
  if (!검사_확장자.test(파일)) continue
  const 머리말 = readFileSync(파일, 'utf8').split('\n').slice(0, 10).join('\n')
  const 정상 = /Date: \d{4}-\d{2}-\d{2}/.test(머리말) && /Author: Jung Minkyu/.test(머리말) && /Purpose: \S/.test(머리말)
  if (!정상) 누락.push(파일)
}

if (누락.length) {
  console.error('헤더(Date / Author: Jung Minkyu / Purpose)가 없는 새 파일:')
  for (const 파일 of 누락) console.error(`  - ${파일}`)
  process.exit(1)
}
console.log(`헤더 검사 통과 (${신규_파일.size}개 신규 파일 확인)`)
