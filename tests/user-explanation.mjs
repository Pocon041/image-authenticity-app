import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..'),
  output = join(root, 'work/user-explanation-test')
await mkdir(output, { recursive: true })
for (const [name, input] of [
  ['explanation', 'src/main/services/explanation.ts'],
  ['presentation', 'src/main/services/user-explanation.ts'],
  ['protocol', 'src/shared/protocol.ts'],
  ['observation', 'src/main/services/visual-observation.ts']
])
  await build({
    input: join(root, input),
    platform: 'node',
    external: ['ajv', 'ajv-formats'],
    output: { file: join(output, `${name}.mjs`), format: 'esm' }
  })
const { generateExplanation } = await import(pathToFileURL(join(output, 'explanation.mjs')))
const { parseUserExplanation } = await import(pathToFileURL(join(output, 'presentation.mjs')))
const { validateExplanationReport } = await import(pathToFileURL(join(output, 'protocol.mjs')))
const { regionContext, observeRegions } = await import(
  pathToFileURL(join(output, 'observation.mjs'))
)
const checks = []
const candidate = {
  finalDecision: 'suspicious',
  summary: '右侧有一处值得关注的局部区域。',
  evidenceBalance: '整图与局部检查的结果存在差异，标记位置值得优先查看。',
  primaryRegionId: 'A',
  regions: [
    {
      regionId: 'A',
      location: '图片右侧',
      subject: '局部对象',
      reason: '局部检查集中标记了这个对象，建议重点核查。',
      suspectedOperation: '复制移动',
      operationReason: '模型基于当前线索提出的候选方式。'
    }
  ]
}
assert.ok(parseUserExplanation(candidate, ['A']))
for (const bad of [
  null,
  {},
  { ...candidate, regions: [], primaryRegionId: 'A' },
  { ...candidate, regions: [{ ...candidate.regions[0], regionId: 'unknown' }] },
  { ...candidate, regions: [candidate.regions[0], candidate.regions[0]] }
])
  assert.equal(parseUserExplanation(bad, ['A']), null)
for (const summary of [
  'RITA置信度0.99',
  'SICA阈值为0.5',
  '这个区域需要进一步仔细核查。这个区域需要进一步仔细核查。'
])
  assert.ok(parseUserExplanation({ ...candidate, summary }, ['A']))
assert.ok(parseUserExplanation({ ...candidate, regions: [], primaryRegionId: null }, ['A']))
const flat = {
  finalDecision: 'suspicious',
  primaryRegionId: 'A',
  subject: '局部对象',
  suspectedOperation: 'copy_move',
  explanation: '保留模型自己的文字，包括RITA和0.99。'
}
assert.equal(parseUserExplanation(flat, ['A']).regions[0].suspectedOperation, '复制移动')
assert.ok(
  parseUserExplanation({ ...flat, finalDecision: 'no_anomaly_detected', primaryRegionId: null }, [
    'A'
  ])
)
assert.equal(parseUserExplanation({ ...flat, primaryRegionId: 'unknown' }, ['A']), null)
checks.push('only shape and reference validation; no keyword or wording rejection')

const taskId = 'user-explanation-fixture',
  directory = join(root, 'work/analysis-runs', taskId)
await mkdir(join(directory, 'images'), { recursive: true })
const png = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#7b93aa' } })
  .png()
  .toBuffer()
for (const name of ['display', 'mask']) await writeFile(join(directory, `images/${name}.png`), png)
const focused = await regionContext(png, png, { bboxXYWH: [1, 1, 3, 3] })
const focusedPixels = await sharp(focused.bytes).removeAlpha().raw().toBuffer()
const originalPixels = await sharp(png)
  .extract({
    left: focused.bbox[0],
    top: focused.bbox[1],
    width: focused.bbox[2],
    height: focused.bbox[3]
  })
  .removeAlpha()
  .raw()
  .toBuffer()
assert.deepEqual(focusedPixels, originalPixels)
const wrongMask = await sharp({ create: { width: 3, height: 3, channels: 3, background: 'white' } })
  .png()
  .toBuffer()
await assert.rejects(regionContext(png, wrongMask, { bboxXYWH: [1, 1, 3, 3] }), /尺寸/)
await assert.rejects(regionContext(png, png, { bboxXYWH: [20, 20, 2, 2] }), /超出/)
checks.push(
  'context crop preserves original pixels and rejects mismatched masks or out-of-bounds regions'
)
const imageId = `sha256:${createHash('sha256').update(png).digest('hex')}`
const confidence = {
  value: 0.88,
  description: '标记区域内像素的平均篡改响应',
  target: 'marked_region_pixels',
  source: 'mean_tamper_response',
  calibrated: false,
  comparableAcrossModels: false
}
const evidence = (id, detector) => ({
  evidenceId: id,
  kind: detector === 'sica' ? 'image_classification' : 'model_localization',
  origin: 'measured',
  description: 'Synthetic integration fixture',
  regionId: detector === 'rita' ? 'region-real' : null,
  artifactIds: detector === 'rita' ? ['mask'] : [],
  data: { detector },
  limitation: 'No model inference'
})
const manipulation = {
  schemaVersion: '1.0',
  reportId: 'fixture-manipulation',
  moduleId: 'manipulation',
  imageId,
  taskId,
  mode: 'local',
  status: 'completed',
  producer: { name: 'TEST FIXTURE', version: 'test-only' },
  createdAt: '2026-11-05T00:00:00Z',
  elapsedMs: 1,
  inputReportIds: [],
  error: null,
  artifacts: [],
  limitations: [],
  evidence: [evidence('sica-evidence', 'sica'), evidence('region-evidence', 'rita')],
  result: {
    decision: 'inconclusive',
    score: null,
    operationHints: [],
    regions: [
      {
        regionId: 'region-real',
        detector: 'rita',
        bboxXYWH: [1, 1, 3, 3],
        areaPixels: 9,
        coordinateSpace: 'display_image_pixels',
        maskArtifactId: 'mask',
        confidence
      }
    ],
    detectors: [
      {
        backend: 'sica',
        status: 'completed',
        result: {
          score: { value: 0.3 },
          classification: { predictedClass: 'real', threshold: 0.5 }
        }
      },
      { backend: 'rita', status: 'completed', result: { regionCount: 1, confidence } }
    ]
  }
}
const artifact = (artifactId, type) => ({
  artifactId,
  type,
  uri: `images/${type === 'display' ? 'display' : 'mask'}.png`,
  sourceArtifactId: type === 'display' ? 'original' : 'display'
})
const bundle = {
  image: { imageId, displayArtifactId: 'display' },
  reports: [manipulation],
  artifacts: [artifact('display', 'display'), artifact('mask', 'mask')]
}
const config = join(output, 'explanation.local.json')
await writeFile(config, JSON.stringify({ maxImages: 3 }))
const previous = process.env.SRDP_EXPLANATION_CONFIG
process.env.SRDP_EXPLANATION_CONFIG = config
const originalFetch = globalThis.fetch
let calls = 0,
  captured
globalThis.fetch = async (url, options) => {
  calls++
  captured = JSON.parse(options.body)
  return new Response(
    JSON.stringify({
      done_reason: 'stop',
      message: { content: captured.format ? JSON.stringify(candidate) : '标记覆盖了一处局部对象。' }
    }),
    { status: 200 }
  )
}
try {
  const result = await generateExplanation(
    bundle,
    taskId,
    'fixture-model',
    'http://127.0.0.1:11434'
  )
  assert.equal(result.result.finalDecision, 'suspicious')
  assert.equal(result.result.upstreamDecision, 'inconclusive')
  assert.equal(result.result.decisionSource, 'vlm')
  assert.equal(result.result.confidence.value, null)
  assert.equal(result.result.regionAnalyses[0].regionId, 'region-real')
  assert.deepEqual(result.result.regionAnalyses[0].evidenceIds, ['region-evidence'])
  assert.deepEqual(validateExplanationReport(result, [manipulation]), [])
  const message = captured.messages.find((m) => m.role === 'user'),
    context = JSON.parse(message.content)
  assert.equal(message.images.length, 2)
  assert.deepEqual(context.images, [
    { index: 1, role: 'full_image' },
    { index: 2, role: 'predicted_mask', regions: ['A'] }
  ])
  assert.equal(context.models.find((m) => m.model === 'RITA').regions[0].regionId, 'A')
  assert.equal(context.aggregateDecision, undefined)
  assert.equal(calls, 2)
  assert.equal(context.regionObservations[0].content, '标记覆盖了一处局部对象。')
  assert.equal(result.result.primaryRegionId, 'region-real')
  assert.equal(result.result.regionAnalyses[0].suspectedOperation, '复制移动')
  assert.equal(result.result.regionAnalyses[0].operationSource, 'vlm_hypothesis')
  assert.ok(result.extensions.rawJudgements.length === 1)
  const invalid = {
    ...result,
    result: {
      ...result.result,
      regionAnalyses: [{ ...result.result.regionAnalyses[0], regionId: 'unknown' }]
    }
  }
  assert.ok(validateExplanationReport(invalid, [manipulation]).some((e) => e.includes('regionId')))
  await writeFile(
    join(output, 'request.json'),
    JSON.stringify(
      {
        ...captured,
        messages: captured.messages.map((m) => ({
          ...m,
          images: m.images?.map(() => '<synthetic image bytes>')
        }))
      },
      null,
      2
    )
  )
  checks.push(
    'full image and mask order, aliases and evidence mapping; VLM judgment is independent of upstream decision'
  )
  globalThis.fetch = async () => {
    throw new Error('Synthetic unavailable service')
  }
  const failedObservations = await observeRegions({
    directory,
    full: png,
    regions: manipulation.result.regions,
    artifacts: bundle.artifacts,
    model: 'fixture',
    host: 'http://127.0.0.1:11434',
    numCtx: 8192
  })
  assert.equal(failedObservations[0].status, 'failed')
  assert.equal(failedObservations[0].text, undefined)
  const fallback = await generateExplanation(
    bundle,
    taskId,
    'fixture-model',
    'http://127.0.0.1:11434'
  )
  assert.equal(fallback.mode, 'mock')
  assert.equal(fallback.result.decisionSource, 'rule_fallback')
  assert.ok(!/SICA|FSD|RITA|RiSE|阈值|z-score/.test(fallback.result.analysis))
  assert.deepEqual(validateExplanationReport(fallback, [manipulation]), [])
  checks.push('unavailable model retains a marked, user-facing fallback and upstream evidence')
} finally {
  globalThis.fetch = originalFetch
  if (previous === undefined) delete process.env.SRDP_EXPLANATION_CONFIG
  else process.env.SRDP_EXPLANATION_CONFIG = previous
}
await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2))
console.log(JSON.stringify({ passed: true, checks }, null, 2))
