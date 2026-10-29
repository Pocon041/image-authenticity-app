import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const python = join(root, '.venv/Scripts/python.exe')
if (!existsSync(python)) {
  console.log('C2PA/Pillow source-reader integration: skipped (run provenance:setup first).')
  process.exit(0)
}

const output = join(root, 'work/provenance-reader')
await mkdir(output, { recursive: true })
const base = await sharp({
  create: { width: 12, height: 9, channels: 3, background: '#789abc' }
}).png().toBuffer()
const ordinaryPath = join(output, 'plain.png')
await writeFile(ordinaryPath, base)

const ordinary = JSON.parse(
  execFileSync(python, [join(root, 'backend/provenance/read_c2pa.py'), ordinaryPath], {
    cwd: root,
    encoding: 'utf8'
  })
)
assert.equal(ordinary.ok, true)
assert.deepEqual(ordinary.metadata.dimensions, [12, 9])
assert.equal(ordinary.metadata.strippingAssessment, 'unknown')
assert.equal(ordinary.c2pa, null)

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const typeBytes = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, crc])
}
function injectC2paChunk(png) {
  let offset = 8
  const chunks = [png.subarray(0, 8)]
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset)
    const end = offset + length + 12
    const name = png.toString('ascii', offset + 4, offset + 8)
    if (name === 'IEND') chunks.push(chunk('caBX', Buffer.from('not a manifest')))
    chunks.push(png.subarray(offset, end))
    offset = end
  }
  return Buffer.concat(chunks)
}
const candidatePath = join(output, 'candidate.png')
await writeFile(candidatePath, injectC2paChunk(base))
const candidate = JSON.parse(
  execFileSync(
    python,
    [join(root, 'backend/provenance/read_c2pa.py'), candidatePath, '--read-c2pa'],
    { cwd: root, encoding: 'utf8' }
  )
)
assert.equal(candidate.ok, true)
assert.deepEqual(candidate.metadata.dimensions, [12, 9])
assert.equal(candidate.c2pa.status, 'failed')
assert.ok(candidate.c2pa.reason)

console.log('C2PA/Pillow source-reader integration: clean image and malformed manifest passed.')
