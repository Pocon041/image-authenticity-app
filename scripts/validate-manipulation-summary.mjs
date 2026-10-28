import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import Ajv from 'ajv'

const root = resolve(import.meta.dirname, '..')
const path = resolve(process.argv[2] ?? 'analysis.json')
const directory = await realpath(dirname(path))
const summary = JSON.parse(await readFile(path, 'utf8'))
const ajv = new Ajv({ allErrors: true })
const validate = ajv.compile(
  JSON.parse(await readFile(resolve(root, 'schemas/manipulation-summary.schema.json'), 'utf8'))
)
assert.ok(validate(summary), ajv.errorsText(validate.errors))
async function bytes(uri) {
  assert.ok(
    typeof uri === 'string' &&
      !isAbsolute(uri) &&
      !uri.includes('\\') &&
      !uri.split('/').includes('..')
  )
  const full = await realpath(resolve(directory, uri)),
    difference = relative(directory, full)
  assert.ok(!isAbsolute(difference) && difference !== '..' && !difference.startsWith(`..${sep}`))
  return readFile(full)
}
const hash = (data) => createHash('sha256').update(data).digest('hex')
assert.equal(hash(await bytes(summary.image.original)), summary.image.sha256)
assert.equal(summary.image.imageId, `sha256:${summary.image.sha256}`)
await bytes(summary.image.display)
const audit = JSON.parse(await bytes(summary.audit))
assert.equal(summary.reportId, audit.reports[0].reportId)
assert.equal(summary.image.imageId, audit.image.imageId)
const evidenceIds = new Set(summary.evidence.map((item) => item.evidenceId))
assert.equal(evidenceIds.size, summary.evidence.length)
for (const entry of summary.evidence) for (const uri of entry.artifacts) await bytes(uri)
for (const detector of summary.localization) {
  for (const id of detector.evidenceIds ?? [])
    assert.ok(evidenceIds.has(id), 'Unresolved evidence ID')
  if (detector.mask) await bytes(detector.mask)
  if (detector.heatmap) await bytes(detector.heatmap)
  if (detector.status === 'completed') {
    const listed = summary.regions.filter((region) => region.model === detector.model.id).length
    assert.equal(listed, detector.listedRegionCount)
    assert.ok(detector.regionCount >= listed)
  }
}
const regionIds = new Set()
for (const region of summary.regions) {
  assert.ok(!regionIds.has(region.regionId))
  regionIds.add(region.regionId)
  const [x, y, w, h] = region.bboxXYWH
  assert.ok(w > 0 && h > 0 && x + w <= summary.image.width && y + h <= summary.image.height)
  assert.ok(
    summary.localization.some((d) => d.model.id === region.model && d.status === 'completed')
  )
  if (region.crop) await bytes(region.crop)
}
console.log(
  `PASS: concise report, references and image identity (${(await readFile(path)).length} bytes)`
)
