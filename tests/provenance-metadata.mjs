import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import ts from 'typescript'

const source = await readFile(
  resolve(import.meta.dirname, '../src/main/services/provenance-metadata.ts'),
  'utf8'
)
const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true
})
assert.deepEqual(diagnostics, [])
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
const { parseIptc, parseXmp, provenanceMetadataSummary } = await import(moduleUrl)

const xmp = Buffer.from(
  '<x:xmpmeta><tiff:Model>Camera X</tiff:Model><xmp:CreatorTool>Adobe Photoshop</xmp:CreatorTool><xmp:CreateDate>2026-10-28T10:00:00Z</xmp:CreateDate></x:xmpmeta>'
)
const parsedXmp = parseXmp(xmp)
assert.equal(parsedXmp.status, 'parsed')
assert.deepEqual(parsedXmp.fields['tiff:Model'], ['Camera X'])
assert.deepEqual(parsedXmp.fields['xmp:CreatorTool'], ['Adobe Photoshop'])

const iptcRecord = (dataset, value) => {
  const length = Buffer.alloc(2)
  length.writeUInt16BE(Buffer.byteLength(value))
  return Buffer.concat([Buffer.from([0x1c, 2, dataset]), length, Buffer.from(value)])
}
const parsedIptc = parseIptc(Buffer.concat([iptcRecord(80, 'Photo Author'), iptcRecord(25, 'licensed')]))
assert.equal(parsedIptc.status, 'parsed')
assert.deepEqual(parsedIptc.fields.byline, ['Photo Author'])
assert.deepEqual(parsedIptc.fields.keywords, ['licensed'])

const summary = provenanceMetadataSummary(
  {
    format: 'jpeg',
    width: 640,
    height: 480,
    orientation: 6,
    channels: 3,
    space: 'srgb',
    depth: 'uchar',
    density: 72,
    exif: Buffer.from('exif'),
    icc: undefined,
    iptc: Buffer.from('iptc')
  },
  { exif: { Make: 'Camera X' }, gps: { latitude: 1.25 }, xmp: {} },
  { status: 'completed' }
)
assert.equal(summary.exif.Make, 'Camera X')
assert.equal(summary.gps.latitude, 1.25)
assert.equal(summary.strippingAssessment, 'unknown')

console.log('Provenance metadata parsing: XMP, IPTC, EXIF/GPS summary passed.')
