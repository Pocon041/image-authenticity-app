// Synthetic detector adapters exercise orchestration only; no model-quality claims.
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { build } from 'rolldown'

const root = resolve(import.meta.dirname, '..')
const temporary = join(root, 'work/workflow-unit')
await mkdir(temporary, { recursive: true })
await build({
  input: join(root, 'src/main/services/workflow.ts'),
  platform: 'node',
  external: [/^node:/, 'sharp', 'ajv', 'ajv-formats'],
  output: { file: join(temporary, 'workflow.mjs'), format: 'esm' }
})
await build({
  input: join(root, 'src/main/services/analysis-session.ts'),
  platform: 'node',
  external: [/^node:/],
  output: { file: join(temporary, 'session.mjs'), format: 'esm' }
})
const { WorkflowAnalysisService } = await import(pathToFileURL(join(temporary, 'workflow.mjs')))
const { AnalysisSession } = await import(pathToFileURL(join(temporary, 'session.mjs')))
const bytes = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#789abc' } })
  .png()
  .toBuffer()
const hash = (data) => createHash('sha256').update(data).digest('hex')
const imageHash = hash(bytes)
const input = {
  sourcePath: 'synthetic-test.png',
  originalBytes: bytes,
  asset: {
    id: `sha256:${imageHash}`,
    sha256: imageHash,
    name: 'synthetic-test.png',
    width: 16,
    height: 12,
    size: bytes.length,
    mimeType: 'image/png',
    dataUrl: `data:image/png;base64,${bytes.toString('base64')}`
  }
}
const checks = []

function fixtureServices({ decision = 'real', fail = [], tamper = false, abort } = {}) {
  const calls = []
  let active = 0,
    maximum = 0
  const services = Object.fromEntries(
    ['sica', 'rita', 'rise'].map((backend) => [
      backend,
      {
        async analyze(image, context) {
          calls.push(backend)
          active++
          maximum = Math.max(maximum, active)
          try {
            await new Promise((resolve) => setTimeout(resolve, 4))
            if (abort === backend) {
              const pending = new Promise((_, reject) =>
                context.signal.addEventListener(
                  'abort',
                  () => reject(new Error('fixture cancelled')),
                  { once: true }
                )
              )
              context.onProgress({ percent: 20, label: 'fixture phase started' })
              await pending
            }
            if (fail.includes(backend)) throw new Error(`TEST FIXTURE ${backend} failed`)
            const directory = join(temporary, context.taskId, backend)
            await mkdir(directory, { recursive: true })
            const id = `test-${randomUUID()}`
            const image = {
              imageId: input.asset.id,
              sha256: imageHash,
              originalArtifactId: `${imageHash}:original`,
              displayArtifactId: `${imageHash}:display`,
              encodedWidth: 16,
              encodedHeight: 12,
              width: 16,
              height: 12,
              exifOrientation: 1,
              coordinateSpace: 'display_image_pixels',
              displayTransform: 'exif_auto_orient_no_resize'
            }
            const artifact = (
              artifactId,
              type,
              uri,
              data,
              width = 16,
              height = 12,
              bbox = null
            ) => ({
              artifactId,
              type,
              uri,
              mediaType: 'image/png',
              sha256: hash(data),
              width,
              height,
              coordinateSpace:
                type === 'original'
                  ? 'encoded_file_pixels'
                  : type === 'crop'
                    ? 'region_local_pixels'
                    : 'display_image_pixels',
              bboxXYWH: bbox,
              sourceArtifactId: type === 'original' ? null : image.displayArtifactId,
              origin: type === 'original' ? 'original' : 'derived'
            })
            const original = artifact(image.originalArtifactId, 'original', 'original.png', bytes)
            original.sourceArtifactId = null
            const displayBytes = await sharp(bytes).rotate().toColourspace('srgb').png().toBuffer()
            const display = artifact(
              image.displayArtifactId,
              'display',
              'display.png',
              displayBytes
            )
            display.sourceArtifactId = image.originalArtifactId
            await writeFile(join(directory, original.uri), bytes)
            await writeFile(join(directory, display.uri), displayBytes)
            const own = [],
              regions = []
            if (backend !== 'sica') {
              const mask = await sharp({
                create: { width: 16, height: 12, channels: 3, background: 'white' }
              })
                .greyscale()
                .png()
                .toBuffer()
              const crop = await sharp(bytes)
                .extract({ left: 2, top: 3, width: 4, height: 5 })
                .png()
                .toBuffer()
              own.push(
                artifact(`${id}:mask`, 'mask', 'mask.png', mask),
                artifact(`${id}:crop`, 'crop', 'crop.png', crop, 4, 5, [2, 3, 4, 5])
              )
              await writeFile(join(directory, 'mask.png'), mask)
              await writeFile(join(directory, 'crop.png'), crop)
              regions.push({
                regionId: `${id}:region`,
                bboxXYWH: [2, 3, 4, 5],
                coordinateSpace: 'display_image_pixels',
                maskArtifactId: `${id}:mask`,
                cropArtifactId: `${id}:crop`
              })
            }
            const report = {
              schemaVersion: '1.0',
              reportId: id,
              moduleId: 'manipulation',
              imageId: image.imageId,
              taskId: context.taskId,
              mode: 'local',
              status: 'completed',
              producer: { name: `TEST FIXTURE ${backend}`, version: 'test-only' },
              createdAt: new Date().toISOString(),
              elapsedMs: 1,
              inputReportIds: [],
              result: { decision: 'inconclusive', score: null, regions, operationHints: [] },
              evidence: [
                {
                  evidenceId: `${id}:evidence`,
                  kind: 'test_fixture',
                  origin: 'measured',
                  description: 'Synthetic fixture; never a real inference result',
                  regionId: null,
                  artifactIds: own.length ? [own[0].artifactId] : [],
                  data: { simulated: true },
                  limitation: 'Engineering test only'
                }
              ],
              artifacts: own,
              limitations: ['Engineering test fixture'],
              error: null
            }
            const bundle = {
              schemaVersion: '1.0',
              bundleId: `bundle-${id}`,
              purpose: 'analysis',
              createdAt: report.createdAt,
              image,
              reports: [report],
              artifacts: [original, display, ...own]
            }
            await writeFile(join(directory, 'bundle.json'), JSON.stringify(bundle))
            if (tamper && backend === 'rita')
              await writeFile(join(directory, 'mask.png'), 'corrupted')
            const shared = { bundlePath: join(directory, 'bundle.json'), bundle }
            return {
              id,
              imageId: image.imageId,
              mode: 'local',
              ...(backend === 'sica'
                ? {
                    classification: {
                      ...shared,
                      decision,
                      score: decision === 'real' ? 0.1 : 0.9,
                      threshold: 0.5,
                      checkpointVariant: 'test-only'
                    }
                  }
                : {
                    localization: {
                      ...shared,
                      decision: 'inconclusive',
                      score: null,
                      regionCount: 1,
                      manipulatedAreaFraction: 0.1,
                      overlayDataUrl: input.asset.dataUrl
                    }
                  })
            }
          } finally {
            active--
          }
        }
      }
    ])
  )
  return {
    services,
    calls,
    get maximum() {
      return maximum
    }
  }
}
function context(contentType, extra = {}) {
  return {
    backend: 'workflow',
    taskId: randomUUID(),
    workflowOptions: { contentType },
    signal: new AbortController().signal,
    onProgress() {},
    ...extra
  }
}

const photo = fixtureServices()
const photoReport = await new WorkflowAnalysisService(root, photo.services).analyze(
  input,
  context('photo')
)
assert.deepEqual(photo.calls, ['sica', 'rita'])
assert.equal(photoReport.workflow.detectors.find((x) => x.backend === 'rise').status, 'not_run')
assert.equal(photoReport.workflow.detectors.find((x) => x.backend === 'rita').status, 'completed')
assert.ok(photoReport.workflow.flags.some((x) => x.includes('倾向真实')))
checks.push('SICA negative never gates RITA; photo routing and disagreement')

const document = fixtureServices({ fail: ['sica'] })
const partial = await new WorkflowAnalysisService(root, document.services).analyze(
  input,
  context('document')
)
assert.deepEqual(document.calls, ['sica', 'rise'])
assert.equal(partial.workflow.status, 'partial')
assert.equal(partial.workflow.detectors.find((x) => x.backend === 'rise').status, 'completed')
checks.push('SICA failure preserves RiSE evidence and reports partial completion')

const uncertain = fixtureServices()
const both = await new WorkflowAnalysisService(root, uncertain.services).analyze(
  input,
  context('unsure')
)
assert.deepEqual(uncertain.calls, ['sica', 'rita', 'rise'])
assert.equal(uncertain.maximum, 1)
assert.equal(both.workflow.bundle.reports.length, 2)
assert.equal(both.workflow.bundle.reports[0].result.score, null)
assert.equal(both.workflow.bundle.reports[0].result.regions.length, 2)
assert.equal(both.workflow.bundle.reports[1].moduleId, 'provenance')
assert.equal(both.workflow.bundle.reports[1].evidence.length, 4)
assert.equal(
  both.workflow.bundle.artifacts.filter((a) => ['original', 'display'].includes(a.type)).length,
  2
)
assert.equal(
  new Set(both.workflow.bundle.artifacts.map((a) => a.artifactId)).size,
  both.workflow.bundle.artifacts.length
)
assert.ok(
  both.workflow.bundle.artifacts
    .filter((a) => a.type === 'mask')
    .every((a) => a.uri.startsWith('detectors/'))
)
assert.equal(both.workflow.summary.reportType, 'manipulation_summary')
assert.equal(both.workflow.summary.regions.length, 2)
assert.equal(JSON.stringify(both.workflow.summary).includes('sourceFiles'), false)
assert.equal(JSON.stringify(both.workflow.summary).includes('data:image'), false)
assert.equal(JSON.stringify(both.workflow.summary).includes('expertSelectionConfidence'), false)
assert.ok(JSON.stringify(both.workflow.summary).length < 10000)
checks.push(
  'uncertain routing is sequential; independent provenance/manipulation reports, separate masks and deduplicated input'
)
checks.push(
  'concise report retains evidence and regions without source lists, tile scores or embedded images'
)

const supplement = fixtureServices()
const supplemented = await new WorkflowAnalysisService(root, supplement.services).analyze(
  input,
  context('photo', {
    previousReport: photoReport,
    workflowOptions: { contentType: 'photo', supplementFromTaskId: photoReport.id }
  })
)
assert.deepEqual(supplement.calls, ['rise'])
assert.equal(supplemented.workflow.detectors.filter((d) => d.reused).length, 2)
checks.push('supplement runs only missing detector and preserves completed evidence')

const failed = fixtureServices({ fail: ['sica', 'rita', 'rise'] })
const failedReport = await new WorkflowAnalysisService(root, failed.services).analyze(
  input,
  context('unsure')
)
assert.equal(failedReport.workflow.status, 'failed')
assert.equal(failedReport.workflow.bundle.reports[0].result, null)
assert.equal(failedReport.workflow.bundle.reports[0].error.code, 'ALL_DETECTORS_FAILED')
assert.equal(failedReport.workflow.bundle.reports[1].moduleId, 'provenance')
checks.push('all detector failures never become no-anomaly results')

const controller = new AbortController(),
  cancelFixture = fixtureServices({ abort: 'rita' })
const cancelContext = context('unsure', {
  signal: controller.signal,
  onProgress(p) {
    if (p.label.includes('fixture phase started')) controller.abort()
  }
})
await assert.rejects(
  new WorkflowAnalysisService(root, cancelFixture.services).analyze(input, cancelContext)
)
assert.deepEqual(cancelFixture.calls, ['sica', 'rita'])
await assert.rejects(access(join(root, 'work/analysis-runs', cancelContext.taskId, 'bundle.json')))
assert.equal(
  JSON.parse(await readFile(join(root, 'work/analysis-runs', cancelContext.taskId, 'run.json')))
    .status,
  'cancelled'
)
checks.push('cancellation stops queued stages and leaves no completed bundle')

const corrupt = fixtureServices({ tamper: true })
await assert.rejects(
  new WorkflowAnalysisService(root, corrupt.services).analyze(input, context('photo')),
  /哈希不一致/
)
checks.push('artifact corruption is rejected')

const sessionFixture = fixtureServices()
const session = new AnalysisSession(new WorkflowAnalysisService(root, sessionFixture.services))
session.selectImage(input)
await session.analyze(input.asset.id, randomUUID(), () => {}, 'workflow', {
  contentType: 'document'
})
await assert.rejects(
  session.analyze(input.asset.id, randomUUID(), () => {}, 'workflow', {
    contentType: 'document',
    supplementFromTaskId: 'invalid-previous'
  }),
  /已失效/
)
checks.push('session rejects stale supplement references')

await writeFile(
  join(temporary, 'result.json'),
  JSON.stringify(
    { passed: true, checks, scope: 'synthetic engineering fixtures; no model quality evaluation' },
    null,
    2
  )
)
console.log(JSON.stringify({ passed: true, checks }, null, 2))
