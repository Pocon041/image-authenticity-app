import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Ajv from 'ajv'
import ts from 'typescript'

const source = await readFile(
  resolve(import.meta.dirname, '../src/main/services/watermark-metadata.ts'),
  'utf8'
)
const { outputText, diagnostics } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  reportDiagnostics: true
})
assert.deepEqual(diagnostics, [])
const moduleUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
const { scanMetadataWatermark } = await import(moduleUrl)
const reportSchema = JSON.parse(
  await readFile(resolve(import.meta.dirname, '../schemas/report-bundle.schema.json'), 'utf8')
)
const validateProvenance = new Ajv({ strict: false }).compile({
  $schema: reportSchema.$schema,
  $defs: reportSchema.$defs,
  $ref: '#/$defs/provenanceResult'
})
const makeProvenanceResult = (watermark) => ({
  preprocessing: {
    originalPreserved: true,
    displayTransform: 'exif_auto_orient_no_resize'
  },
  metadata: { status: 'completed', details: {} },
  credentials: { status: 'not_run', details: {} },
  watermark
})

const matches = scanMetadataWatermark({
  xmp: Buffer.from('<xmp:description>Adobe Stock watermark preview</xmp:description>'),
  iptc: 'Distributed by Getty Images',
  exif: Buffer.from('camera metadata')
})
assert.equal(matches.status, 'completed')
assert.equal(matches.details.outcome, 'candidate_markers_found')
assert.deepEqual(matches.details.inspectedSegments, ['exif', 'xmp', 'iptc'])
assert.deepEqual(matches.details.candidateMarkers, ['watermark_keyword', 'adobe_stock', 'getty_images'])
assert.equal(validateProvenance(makeProvenanceResult(matches)), true)

const clean = scanMetadataWatermark({ exif: Buffer.from('camera metadata') })
assert.equal(clean.details.outcome, 'no_known_markers_found')
assert.deepEqual(clean.details.candidateMarkers, [])
assert.equal(validateProvenance(makeProvenanceResult(clean)), true)

const absent = scanMetadataWatermark({})
assert.equal(absent.details.outcome, 'no_metadata_to_scan')
assert.deepEqual(absent.details.inspectedSegments, [])
assert.equal(validateProvenance(makeProvenanceResult(absent)), true)

console.log('Watermark metadata scan: 3 cases passed.')
