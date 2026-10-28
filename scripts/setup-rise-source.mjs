import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, '.tools/rise-official')
const lock = JSON.parse(await readFile(join(root, 'backend/rise/source-lock.json'), 'utf8'))
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`RiSE source setup failed: ${result.stderr}`)
  return result.stdout.trim()
}
let exists = false
try {
  await access(join(source, '.git'))
  exists = true
} catch {
  /* First setup. */
}
if (!exists) git(['clone', '--depth', '1', 'https://github.com/KahimWong/RiSE.git', source])
if (git(['-C', source, 'status', '--porcelain', '--untracked-files=no']))
  throw new Error('RiSE checkout has modified tracked files; refusing to overwrite them')
if (git(['-C', source, 'rev-parse', 'HEAD']) !== lock.commit) {
  git(['-C', source, 'fetch', '--depth', '1', 'origin', lock.commit])
  git(['-C', source, 'checkout', '--detach', lock.commit])
}
for (const [name, expected] of Object.entries(lock.files)) {
  const content = (await readFile(join(source, name), 'utf8')).replace(/\r\n/g, '\n')
  const actual = createHash('sha256').update(content).digest('hex')
  if (actual !== expected) throw new Error(`RiSE source checksum mismatch: ${name}`)
}
console.log(
  `Verified official RiSE source ${lock.commit}. No weights or Python packages installed.`
)
