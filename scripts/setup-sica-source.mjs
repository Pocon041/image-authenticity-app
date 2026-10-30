import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commit = 'def6e344ca3f18a2313adb6be3bd1f8fb8d27e7d'
//const expected = 'c82d71ddb0664a74c7e0b056cf661b3b55c815342bc842bce3ab8629ee05a87c'
const expected = 'a59aef434979e822d728eb7634524faa8a9030c9714f4e9bfe2fa71101eece12'
const clipCommit = 'd05afc436d78f1c48dc0dbf8e5980a9d471f35f6'
const source = join(root, '.tools/sica-upstream/model.py')
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
let bytes
try {
  bytes = await readFile(source)
} catch {
  /* First setup. */
}
if (!bytes || digest(bytes) !== expected) {
  const response = await fetch(
    `https://raw.githubusercontent.com/venus-guangjian/SICA_OpenMMSec/${commit}/model.py`,
    { signal: AbortSignal.timeout(30000) }
  )
  if (!response.ok) throw new Error(`SICA source download failed: ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
  if (digest(bytes) !== expected) throw new Error('Official SICA model checksum mismatch')
  await mkdir(dirname(source), { recursive: true })
  await writeFile(source, bytes)
}
const clipRoot = join(root, '.tools/openai-clip')
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`CLIP source setup failed: ${result.stderr}`)
  return result.stdout.trim()
}
let exists = false
try {
  await access(join(clipRoot, '.git'))
  exists = true
} catch {
  /* Clone next. */
}
if (!exists) git(['clone', '--depth', '1', 'https://github.com/openai/CLIP.git', clipRoot])
if (git(['-C', clipRoot, 'status', '--porcelain', '--untracked-files=no']))
  throw new Error('CLIP checkout contains modified tracked files; restore it before setup')
if (git(['-C', clipRoot, 'rev-parse', 'HEAD']) !== clipCommit) {
  git(['-C', clipRoot, 'fetch', '--depth', '1', 'origin', clipCommit])
  git(['-C', clipRoot, 'checkout', '--detach', clipCommit])
}
const names = [
  'clip/__init__.py',
  'clip/model.py',
  'clip/clip.py',
  'clip/simple_tokenizer.py',
  'clip/bpe_simple_vocab_16e6.txt.gz'
]
const files = Object.fromEntries(
  await Promise.all(names.map(async (name) => [name, digest(await readFile(join(clipRoot, name)))]))
)
await writeFile(
  join(clipRoot, 'srdp-source-manifest.json'),
  JSON.stringify({ commit: clipCommit, files }, null, 2)
)
console.log('Verified pinned SICA and CLIP source. No weights or Python packages were installed.')
