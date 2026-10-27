import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const commit = 'b50efcd5b4c41b8bfc69b0b10ce6230dcb67b983'
const expected = '599223ee738f81d5e3fa55cba881277b4aa7e4e97e40b9e60b2fa001cb0df4b4'
const path = resolve(root, '.tools/rita-upstream/rita.py')
let bytes
try {
  bytes = await readFile(path)
} catch {
  /* First setup. */
}
if (!bytes || createHash('sha256').update(bytes).digest('hex') !== expected) {
  const response = await fetch(`https://raw.githubusercontent.com/scu-zjz/RITA/${commit}/rita.py`, {
    signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) throw new Error(`Official source download failed: ${response.status}`)
  bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('RITA source checksum mismatch')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
}
console.log(`Verified official RITA source at ${path} (commit ${commit}).`)
console.log(
  'Download the official checkpoint to weights/rita/rita_catnet.pth; configure config/rita.local.json separately.'
)
