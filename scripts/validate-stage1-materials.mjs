import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
if (args.includes('--bundle')) {
  const check = spawnSync(
    process.execPath,
    [
      join(project, 'scripts/validate-report-examples.mjs'),
      '--bundle',
      resolve(project, option('--bundle'))
    ],
    { stdio: 'inherit' }
  )
  process.exit(check.status ?? 1)
}
const root = await realpath(resolve(project, option('--input', 'examples/stage1-materials')))
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function load(uri) {
  assert.ok(!isAbsolute(uri) && !uri.includes('\\') && !uri.split('/').includes('..'))
  const path = await realpath(resolve(root, uri))
  const difference = relative(root, path)
  assert.ok(difference !== '..' && !difference.startsWith(`..${sep}`) && !isAbsolute(difference))
  return readFile(path)
}
const lines = (await readFile(join(root, 'manifest.tsv'), 'utf8'))
  .replace(/^\uFEFF/, '')
  .trimEnd()
  .split(/\r?\n/)
const header = lines.shift().split('\t')
const rows = lines.map((line) =>
  Object.fromEntries(line.split('\t').map((cell, index) => [header[index], cell]))
)
const seen = new Set()
for (const row of rows) {
  assert.ok(!seen.has(row.sampleId))
  seen.add(row.sampleId)
  const original = await load(row.originalUri),
    display = await load(row.displayUri)
  assert.equal(hash(original), row.originalSha256)
  assert.equal(hash(display), row.displaySha256)
  assert.equal(row.imageId, `sha256:${row.originalSha256}`)
  const info = await sharp(original).metadata(),
    dimensions = await sharp(display).metadata()
  assert.equal(info.width, Number(row.encodedWidth))
  assert.equal(info.height, Number(row.encodedHeight))
  assert.equal(info.orientation ?? 1, Number(row.exifOrientation))
  assert.equal(dimensions.width, Number(row.width))
  assert.equal(dimensions.height, Number(row.height))
  const expected = await sharp(original)
    .rotate()
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer()
  const actual = await sharp(display).ensureAlpha().raw().toBuffer()
  assert.ok(expected.equals(actual), 'Canonical image was resized or transformed unexpectedly')
  if (row.annotationUri) {
    const mask = await load(row.annotationUri),
      maskInfo = await sharp(mask).metadata()
    assert.equal(hash(mask), row.annotationSha256)
    assert.equal(maskInfo.width, info.width)
    assert.equal(maskInfo.height, info.height)
  }
}
async function jsonFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await jsonFiles(path)))
    else if (entry.name.endsWith('.json')) files.push(path)
  }
  return files
}
assert.deepEqual(
  await jsonFiles(root),
  [join(root, 'vlm-input.example.json')],
  'Publish exactly one example JSON'
)
const input = JSON.parse(await readFile(join(root, 'vlm-input.example.json'), 'utf8'))
assert.deepEqual(
  input.reports.map((report) => report.moduleId),
  ['provenance', 'manipulation', 'aigc']
)
assert.ok(input.reports.every((report) => report.mode === 'mock'))
assert.ok(input.artifacts.every((asset) => !asset.uri.includes('/annotations/')))
const row = rows.find((item) => item.imageId === input.image.imageId)
assert.ok(row, 'Example input image must be in the catalog')
const check = spawnSync(
  process.execPath,
  [
    join(project, 'scripts/validate-report-examples.mjs'),
    '--bundle',
    join(root, 'vlm-input.example.json')
  ],
  { stdio: 'inherit' }
)
assert.equal(check.status, 0)
console.log(
  `PASS: ${rows.length} images, ${rows.filter((item) => item.annotationUri).length} native masks, original hashes, display geometry, and exactly 1 VLM JSON. No model was run.`
)
