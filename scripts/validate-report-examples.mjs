import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import sharp from 'sharp'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const root = resolve(project, value('--input', 'examples/local-data'))
const schema = JSON.parse(
  await readFile(resolve(project, 'schemas/report-bundle.schema.json'), 'utf8')
)
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema)
const validateReport = ajv.getSchema('urn:image-authenticity-app:evidence-bundle:1.0#/$defs/report')
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')

function inside(rootDirectory, candidate) {
  const path = relative(rootDirectory, candidate)
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path))
}

function checkBounds(bbox, image) {
  const [x, y, width, height] = bbox
  assert.ok(x + width <= image.width && y + height <= image.height, `Out-of-bounds bbox: ${bbox}`)
}

async function checkBundle(bundlePath) {
  const bundle = await json(bundlePath)
  assert.ok(validate(bundle), JSON.stringify(validate.errors, null, 2))
  const directory = await realpath(dirname(bundlePath))
  const { image } = bundle
  assert.equal(
    image.imageId,
    `sha256:${image.sha256}`,
    'imageId must use the complete original-file SHA256'
  )
  const assets = new Map(),
    data = new Map()
  for (const asset of bundle.artifacts) {
    assert.ok(!assets.has(asset.artifactId), 'Duplicate artifact ID')
    assert.ok(
      !isAbsolute(asset.uri) && !asset.uri.includes('\\') && !asset.uri.split('/').includes('..'),
      'Artifact URI must be a relative POSIX path without traversal'
    )
    const physicalPath = await realpath(resolve(directory, asset.uri))
    assert.ok(inside(directory, physicalPath), 'Artifact resolves outside the case directory')
    const bytes = await readFile(physicalPath)
    assert.equal(hash(bytes), asset.sha256, `Artifact hash mismatch: ${asset.uri}`)
    const info = await sharp(bytes).metadata()
    assert.equal(info.width, asset.width)
    assert.equal(info.height, asset.height)
    assert.equal(asset.mediaType, `image/${info.format}`)
    if (asset.coordinateSpace === 'display_image_pixels') {
      assert.equal(asset.width, image.width)
      assert.equal(asset.height, image.height)
    }
    if (asset.bboxXYWH) checkBounds(asset.bboxXYWH, image)
    if (asset.type === 'crop') {
      assert.equal(asset.coordinateSpace, 'region_local_pixels')
      assert.ok(asset.bboxXYWH, 'Crop requires a display-space bbox')
      assert.equal(asset.width, asset.bboxXYWH[2])
      assert.equal(asset.height, asset.bboxXYWH[3])
    }
    if (asset.type === 'mask') {
      assert.equal(info.format, 'png')
      const pixels = await sharp(bytes).removeAlpha().greyscale().raw().toBuffer()
      assert.ok(
        pixels.every((pixel) => pixel === 0 || pixel === 255),
        'Binary mask must contain only 0/255'
      )
    }
    assets.set(asset.artifactId, asset)
    data.set(asset.artifactId, bytes)
  }
  for (const asset of assets.values()) {
    if (asset.sourceArtifactId)
      assert.ok(assets.has(asset.sourceArtifactId), 'Unresolved source artifact')
  }
  const original = assets.get(image.originalArtifactId),
    display = assets.get(image.displayArtifactId)
  assert.equal(original?.type, 'original')
  assert.equal(display?.type, 'display')
  assert.equal(original.sha256, image.sha256)
  assert.equal(original.width, image.encodedWidth)
  assert.equal(original.height, image.encodedHeight)
  assert.equal(display.width, image.width)
  assert.equal(display.height, image.height)
  const originalInfo = await sharp(data.get(original.artifactId)).metadata()
  assert.equal(originalInfo.orientation ?? 1, image.exifOrientation)
  const canonicalPixels = await sharp(data.get(original.artifactId))
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer()
  const displayPixels = await sharp(data.get(display.artifactId))
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer()
  assert.ok(
    canonicalPixels.equals(displayPixels),
    'Display must be the EXIF-oriented, unscaled image'
  )
  for (const asset of assets.values()) {
    if (asset.type === 'crop') {
      assert.equal(asset.sourceArtifactId, display.artifactId)
      const [left, top, width, height] = asset.bboxXYWH
      const expected = await sharp(data.get(display.artifactId))
        .extract({ left, top, width, height })
        .ensureAlpha()
        .raw()
        .toBuffer()
      const actual = await sharp(data.get(asset.artifactId)).ensureAlpha().raw().toBuffer()
      assert.ok(expected.equals(actual), 'Crop pixels do not match the display-space bbox')
    }
  }
  const reports = new Map(),
    evidence = new Map(),
    regions = new Map()
  for (const report of bundle.reports) {
    assert.ok(!reports.has(report.reportId), 'Duplicate report ID')
    assert.equal(report.imageId, image.imageId)
    reports.set(report.reportId, report)
    for (const asset of report.artifacts)
      assert.deepEqual(
        asset,
        assets.get(asset.artifactId),
        'Report artifact differs from the bundle index'
      )
    for (const region of report.result?.regions ?? []) {
      assert.ok(!regions.has(region.regionId), 'Duplicate region ID')
      checkBounds(region.bboxXYWH, image)
      if (region.maskArtifactId) assert.equal(assets.get(region.maskArtifactId)?.type, 'mask')
      regions.set(region.regionId, region)
    }
    for (const entry of report.evidence) {
      assert.ok(!evidence.has(entry.evidenceId), 'Duplicate evidence ID')
      if (report.mode === 'local')
        assert.notEqual(entry.origin, 'mock', 'A local report cannot hide mock evidence')
      evidence.set(entry.evidenceId, { entry, owner: report.reportId })
    }
  }
  for (const report of reports.values()) {
    for (const id of report.inputReportIds)
      assert.ok(id !== report.reportId && reports.has(id), 'Unresolved/self input report')
    for (const entry of report.evidence) {
      if (entry.regionId) assert.ok(regions.has(entry.regionId), 'Unresolved region')
      for (const id of entry.artifactIds) assert.ok(assets.has(id), 'Unresolved evidence artifact')
    }
    for (const claim of report.result?.claims ?? []) {
      for (const id of claim.evidenceIds) {
        const cited = evidence.get(id)
        assert.ok(
          cited && report.inputReportIds.includes(cited.owner),
          'Explanation must cite evidence from its input reports'
        )
      }
    }
  }
  const visiting = new Set(),
    visited = new Set()
  function visit(id) {
    assert.ok(!visiting.has(id), 'Report dependency cycle')
    if (visited.has(id)) return
    visiting.add(id)
    for (const parent of reports.get(id).inputReportIds) visit(parent)
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of reports.keys()) visit(id)
  return bundle
}

if (args.includes('--bundle')) {
  const path = resolve(project, value('--bundle'))
  await checkBundle(path)
  console.log(`PASS: ${path}`)
} else {
  const manifest = await json(resolve(root, 'manifest.json'))
  for (const item of manifest.cases) {
    const bundlePath = resolve(root, item.bundle)
    assert.ok(inside(root, bundlePath), 'Manifest resolves outside the sample root')
    const bundle = await checkBundle(bundlePath)
    const input = await checkBundle(resolve(root, item.vlmInput))
    assert.ok(
      input.reports.every((report) => report.moduleId !== 'explanation'),
      'VLM input must not contain its expected explanation output'
    )
    assert.equal(bundle.reports.length, 4)
    for (const report of bundle.reports) {
      assert.equal(report.mode, 'mock')
      const standalone = await json(resolve(dirname(bundlePath), `reports/${report.moduleId}.json`))
      assert.ok(validateReport(standalone), JSON.stringify(validateReport.errors))
      assert.deepEqual(standalone, report)
    }
    const source = await json(resolve(dirname(bundlePath), 'source-record.json'))
    assert.equal(source.sourceSha256, bundle.image.sha256)
    const truth = await json(resolve(dirname(bundlePath), 'ground-truth.json'))
    if (truth.mask) {
      const mask = await readFile(resolve(dirname(bundlePath), truth.mask.uri))
      assert.equal(hash(mask), truth.mask.sha256)
      assert.ok(
        !bundle.artifacts.some((asset) => asset.uri === truth.mask.uri),
        'Dataset truth must not be included as detector evidence'
      )
    }
    console.log(
      `PASS ${item.caseId}: schema, image identity, pixels, coordinates, attachments and evidence references`
    )
  }
  console.log(`Validated ${manifest.cases.length} cases. No application or inference test was run.`)
}
