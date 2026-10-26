import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const provenance = JSON.parse(readFileSync(join(root, 'ThirdParty/target-source.json'), 'utf8'))
const actual = createHash('sha256').update(readFileSync(join(root, 'Assets/Hangil/Target/hangil-target.jpg'))).digest('hex')
if (actual !== provenance.sha256) throw new Error('기준 이미지가 바뀌었습니다. 인쇄물·라이브러리·출처를 함께 갱신해야 합니다.')
const manifest = JSON.parse(readFileSync(join(root, 'Packages/manifest.json'), 'utf8'))
if (manifest.dependencies['com.unity.ugui'] !== '2.0.0') throw new Error('Touch UI requires the pinned uGUI package.')
const uiFont = JSON.parse(readFileSync(join(root, 'ThirdParty/font-source.json'), 'utf8'))
const fontHash = createHash('sha256').update(readFileSync(join(root, 'Assets/Hangil/Resources/HangilUi.ttf'))).digest('hex')
if (fontHash !== uiFont.subset_sha256) throw new Error('UI font provenance does not match the bundled font.')
for (const folder of ['Core', 'Runtime']) {
  for (const name of readdirSync(join(root, 'Assets/Hangil', folder)).filter(name => name.endsWith('.cs'))) {
    for (const char of readFileSync(join(root, 'Assets/Hangil', folder, name), 'utf8')) {
      if (!'\r\n\t'.includes(char) && !uiFont.characters.includes(char)) throw new Error(`UI font subset needs rebuilding: ${char}`)
    }
  }
}
for (const name of ['arfoundation', 'arcore', 'arkit']) {
  if (manifest.dependencies[`com.unity.xr.${name}`] !== '6.3.5') throw new Error('AR 패키지 버전이 서로 다릅니다.')
}
const guids = new Set()
function check(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.endsWith('.meta') || entry.name === 'Generated') continue
    const target = join(path, entry.name)
    if (!existsSync(`${target}.meta`)) throw new Error(`Unity 메타 파일 누락: ${target}`)
    const guid = /guid: ([a-f0-9]{32})/.exec(readFileSync(`${target}.meta`, 'utf8'))?.[1]
    if (!guid || guids.has(guid)) throw new Error(`Unity GUID 오류: ${target}`)
    guids.add(guid)
    if (entry.name.endsWith('.asmdef')) JSON.parse(readFileSync(target, 'utf8'))
    if (entry.isDirectory()) check(target)
  }
}
check(join(root, 'Assets'))
console.log(`기준 이미지 SHA256·패키지·Unity GUID ${guids.size}개 확인. Unity 컴파일·기기 검사는 별도입니다.`)
