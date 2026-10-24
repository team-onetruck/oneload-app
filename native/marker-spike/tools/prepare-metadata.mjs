import { createHash } from 'node:crypto'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
function prepare(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name.endsWith('.meta') || entry.name === 'Generated') continue
    const target = join(path, entry.name)
    const meta = `${target}.meta`
    if (!existsSync(meta)) {
      const guid = createHash('sha256').update(`hangil-marker-spike:${relative(root, target).replaceAll('\\', '/')}`).digest('hex').slice(0, 32)
      let importer = 'DefaultImporter:\n  externalObjects: {}\n'
      if (entry.name.endsWith('.cs')) importer = 'MonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n'
      if (entry.name.endsWith('.asmdef')) importer = 'AssemblyDefinitionImporter:\n  externalObjects: {}\n'
      if (entry.name.endsWith('.jpg')) importer = 'TextureImporter:\n  externalObjects: {}\n  textureType: 0\n'
      writeFileSync(meta, `fileFormatVersion: 2\nguid: ${guid}\n${entry.isDirectory() ? 'folderAsset: yes\n' : ''}${importer}  userData:\n  assetBundleName:\n  assetBundleVariant:\n`)
    }
    if (entry.isDirectory()) prepare(target)
  }
}
prepare(join(root, 'Assets'))
