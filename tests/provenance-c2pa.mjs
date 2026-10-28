import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

const source = await readFile(
  resolve(import.meta.dirname, '../src/main/services/c2pa-presence.ts'),
  'utf8'
)
const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true
})
assert.deepEqual(diagnostics, [])
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
const { scanC2paManifestPresence } = await import(moduleUrl)

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const pngChunk = (name, payload = Buffer.alloc(0)) => {
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  return Buffer.concat([header, Buffer.from(name), payload, Buffer.alloc(4)])
}
const pngWithManifest = Buffer.concat([
  pngSignature,
  pngChunk('caBX', Buffer.from('manifest')),
  pngChunk('IEND')
])
const pngWithoutManifest = Buffer.concat([pngSignature, pngChunk('IEND')])

const c2paJumbfUuid = Buffer.from('6332706100110010800000aa00389b71', 'hex')
const jpegSegment = (marker, payload) => {
  const header = Buffer.alloc(2)
  header.writeUInt16BE(payload.length + 2)
  return Buffer.concat([Buffer.from([0xff, marker]), header, payload])
}
const jpegWithManifest = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  jpegSegment(0xeb, Buffer.concat([Buffer.from('jumb'), c2paJumbfUuid])),
  Buffer.from([0xff, 0xd9])
])
const jpegWithoutManifest = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  jpegSegment(0xe1, Buffer.from('Exif metadata')),
  Buffer.from([0xff, 0xd9])
])

const webpChunk = (name, payload = Buffer.alloc(0)) => {
  const size = Buffer.alloc(4)
  size.writeUInt32LE(payload.length)
  return Buffer.concat([
    Buffer.from(name),
    size,
    payload,
    payload.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)
  ])
}
const webpFile = (chunks) => {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks])
  const size = Buffer.alloc(4)
  size.writeUInt32LE(body.length)
  return Buffer.concat([Buffer.from('RIFF'), size, body])
}

const cases = [
  [pngWithManifest, 'png', 'manifest_container_found', 'png_caBX_chunk'],
  [pngWithoutManifest, 'png', 'no_manifest_container_found', null],
  [jpegWithManifest, 'jpeg', 'manifest_container_found', 'jpeg_app11_jumbf_uuid'],
  [jpegWithoutManifest, 'jpeg', 'no_manifest_container_found', null],
  [webpFile([webpChunk('C2PA', Buffer.from('manifest'))]), 'webp', 'manifest_container_found', 'webp_c2pa_chunk'],
  [webpFile([webpChunk('XMP ', Buffer.from('metadata'))]), 'webp', 'no_manifest_container_found', null]
]

for (const [bytes, format, outcome, location] of cases) {
  const result = scanC2paManifestPresence(bytes, format)
  assert.equal(result.details.outcome, outcome)
  assert.equal(result.details.containerLocation, location)
  assert.equal(result.details.signatureValidation, 'not_run')
}
assert.equal(scanC2paManifestPresence(pngWithManifest, 'bmp').details.outcome, 'unsupported_format')
assert.equal(scanC2paManifestPresence(Buffer.from('bad'), 'png').details.outcome, 'malformed_container')

console.log(`C2PA container scan: ${cases.length + 2} cases passed.`)
