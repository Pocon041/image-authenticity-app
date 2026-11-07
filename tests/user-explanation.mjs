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
  ['observation', 'src/main/services/visual-observation.ts'],
  ['stream', 'src/main/services/ollama-stream.ts'],
  ['boundary', 'src/main/services/visual-boundary.ts'],
  ['evidence', 'src/main/services/explanation-evidence.ts']
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
const { regionContext, observeRegions, quotedReading } = await import(
  pathToFileURL(join(output, 'observation.mjs'))
)
const checks = []
assert.equal(quotedReading('日21:16在'), '21:16')
assert.equal(quotedReading('读到“369.00”'), '369.00')
assert.equal(quotedReading('一只水鸟'), null)
const { readOllamaChat } = await import(pathToFileURL(join(output, 'stream.mjs')))
const finalText = '图片右侧的水鸟值得关注。\n\n可能是复制移动，仍需结合画面细节。'
const makeStream = (complete = true) => {
  const wire =
    [...finalText].map((content) => JSON.stringify({ message: { content } })).join('\n') +
    (complete ? '\n' + JSON.stringify({ done: true, done_reason: 'stop', eval_count: 20 }) : '')
  const bytes = new TextEncoder().encode(wire)
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      }
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } }
  )
}
const streamed = []
const collected = await readOllamaChat(makeStream(), (text) => streamed.push(text))
assert.equal(collected.message.content, finalText)
assert.equal(collected.done_reason, 'stop')
assert.ok(streamed.some((s) => s.length > 1 && s.length < finalText.length))
await assert.rejects(readOllamaChat(makeStream(false)), /中断/)
checks.push('genuine NDJSON handles split UTF8, incremental text and interrupted streams')
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
await writeFile(join(directory, 'images/display.png'), png)
const fixtureMask = Buffer.alloc(16 * 12)
for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) fixtureMask[y * 16 + x] = 255
await writeFile(
  join(directory, 'images/mask.png'),
  await sharp(fixtureMask, { raw: { width: 16, height: 12, channels: 1 } })
    .png()
    .toBuffer()
)
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
const { drawRegionBoundaries } = await import(pathToFileURL(join(output, 'boundary.mjs')))
const boundaryBase = await sharp({
  create: { width: 40, height: 32, channels: 3, background: '#7b93aa' }
})
  .png()
  .toBuffer()
const geometry = { bboxXYWH: [10, 10, 20, 12], areaPixels: 112 }
const maskPixels = Buffer.alloc(40 * 32)
for (let y = 10; y < 22; y++)
  for (let x = 10; x < 30; x++) if (x < 14 || y >= 18) maskPixels[y * 40 + x] = 255
maskPixels[12 * 40 + 24] = 255 // Unrelated island inside the same bbox.
const encodeMask = (data) =>
  sharp(data, { raw: { width: 40, height: 32, channels: 1 } })
    .png()
    .toBuffer()
const contourMask = await encodeMask(maskPixels)
const bounded = await drawRegionBoundaries(boundaryBase, [
  { mask: contourMask, regions: [geometry] }
])
assert.equal((await sharp(bounded).metadata()).width, 40)
assert.equal((await sharp(bounded).metadata()).height, 32)
const rawBase = await sharp(boundaryBase).removeAlpha().raw().toBuffer()
const rawBounded = await sharp(bounded).removeAlpha().raw().toBuffer()
const pixel = (data, x, y) => data.subarray((y * 40 + x) * 3, (y * 40 + x) * 3 + 3)
for (const [x, y] of [
  [2, 2],
  [10, 10],
  [20, 20],
  [29, 10],
  [24, 12],
  [23, 12],
  [25, 12],
  [35, 28]
])
  assert.deepEqual(
    pixel(rawBounded, x, y),
    pixel(rawBase, x, y),
    'No fill, bbox outline or unrelated component annotation'
  )
assert.deepEqual(
  pixel(rawBounded, 14, 14),
  Buffer.from([0, 212, 255]),
  'The line must follow the L-shaped contour, not its rectangle'
)
assert.deepEqual(await drawRegionBoundaries(boundaryBase, []), boundaryBase)
await assert.rejects(
  drawRegionBoundaries(boundaryBase, [
    { mask: contourMask, regions: [{ bboxXYWH: [35, 10, 20, 12] }] }
  ]),
  /超出/
)
await assert.rejects(
  drawRegionBoundaries(boundaryBase, [
    { mask: contourMask, regions: [{ ...geometry, areaPixels: 111 }] }
  ]),
  /匹配/
)
await assert.rejects(
  drawRegionBoundaries(boundaryBase, [{ mask: png, regions: [geometry] }]),
  /尺寸/
)
const holed = Buffer.alloc(40 * 32)
for (let y = 10; y < 22; y++)
  for (let x = 10; x < 30; x++) if (x < 12 || x >= 28 || y < 12 || y >= 20) holed[y * 40 + x] = 255
const holeImage = await drawRegionBoundaries(boundaryBase, [
  { mask: await encodeMask(holed), regions: [geometry] }
])
const holeRaw = await sharp(holeImage).removeAlpha().raw().toBuffer()
assert.deepEqual(
  pixel(holeRaw, 12, 15),
  pixel(rawBase, 12, 15),
  'Internal holes should not gain coloured contours'
)
assert.deepEqual(pixel(holeRaw, 9, 15), Buffer.from([0, 212, 255]))
const diagonal = Buffer.alloc(40 * 32)
for (let i = 0; i < 3; i++) diagonal[(10 + i) * 40 + 10 + i] = 255
await drawRegionBoundaries(boundaryBase, [
  { mask: await encodeMask(diagonal), regions: [{ bboxXYWH: [10, 10, 3, 3], areaPixels: 3 }] }
])
const corner = Buffer.alloc(40 * 32)
for (let y = 0; y < 5; y++) for (let x = 0; x < 10; x++) corner[y * 40 + x] = 255
const clipped = await drawRegionBoundaries(boundaryBase, [
  { mask: await encodeMask(corner), regions: [{ bboxXYWH: [0, 0, 10, 5], areaPixels: 50 }] }
])
assert.equal((await sharp(clipped).metadata()).width, 40)
const wrongMask = await sharp({ create: { width: 3, height: 3, channels: 3, background: 'white' } })
  .png()
  .toBuffer()
await assert.rejects(regionContext(png, wrongMask, { bboxXYWH: [1, 1, 3, 3] }), /尺寸/)
await assert.rejects(regionContext(png, png, { bboxXYWH: [20, 20, 2, 2] }), /超出/)
checks.push(
  'predicted outer contours follow real 8-connected components, skip holes and unrelated islands, preserve pixels and clip at image edges; invalid masks fail explicitly'
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
        bboxXYWH: [1, 1, 8, 8],
        areaPixels: 64,
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
  image: { imageId, displayArtifactId: 'display', width: 16, height: 12 },
  reports: [manipulation],
  artifacts: [artifact('display', 'display'), artifact('mask', 'mask')]
}
const config = join(output, 'explanation.local.json')
await writeFile(config, JSON.stringify({ maxImages: 3 }))
const previous = process.env.SRDP_EXPLANATION_CONFIG
process.env.SRDP_EXPLANATION_CONFIG = config
const originalFetch = globalThis.fetch
const { primaryExplanationRegions } = await import(pathToFileURL(join(output, 'evidence.mjs')))
const sampleRegions = [
  { regionId: 'small', detector: 'rita', bboxXYWH: [0, 0, 2, 2], areaPixels: 4 },
  { regionId: 'large', detector: 'rita', bboxXYWH: [0, 0, 4, 4], areaPixels: 16 },
  { regionId: 'document', detector: 'rise', bboxXYWH: [0, 0, 3, 3], areaPixels: 9 }
]
assert.deepEqual(
  primaryExplanationRegions(sampleRegions).map((r) => r.regionId),
  ['large', 'document']
)
assert.equal(sampleRegions.length, 3)
assert.equal(sampleRegions[0].regionId, 'small')
checks.push(
  'explanation focus follows each localizer area order; all upstream regions remain intact'
)
let requests = [],
  metadataFails = false,
  interrupt = false,
  unavailable = false
let verdict = '存在可疑线索',
  narrationText = finalText
const jsonResponse = (content) =>
  new Response(
    JSON.stringify({
      done_reason: 'stop',
      message: { content: typeof content === 'string' ? content : JSON.stringify(content) }
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
globalThis.fetch = async (_url, options) => {
  const r = JSON.parse(options.body)
  requests.push(r)
  if (unavailable) throw new Error('Synthetic unavailable service')
  if (r.format?.properties?.decision)
    return jsonResponse({
      decision: verdict,
      focusIndex: verdict === '未发现明显异常' ? null : 1,
      targetDescription: '图片右侧的水鸟',
      operation: verdict === '未发现明显异常' ? 'unknown' : 'copy_move',
      operationReason: '模型综合判断提出的方式假设。'
    })
  if (r.format?.properties?.focusIndex) return jsonResponse({ focusIndex: 1 })
  if (r.format?.properties?.记录)
    return jsonResponse({ 记录: '图片右侧', 字段: '水鸟', 原文: null })
  if (r.format?.properties?.context) return jsonResponse({ context: '图片右侧的水鸟' })
  if (r.format?.properties?.subject)
    return jsonResponse({ subject: '一只水鸟。', visibleText: null })
  if (r.format?.properties?.operation)
    return jsonResponse({ operation: 'unknown', reason: '无法区分', evidenceType: 'none' })
  if (r.format?.properties?.suspectedOperationQuote) {
    if (metadataFails) throw new Error('Synthetic method-only failure')
    return jsonResponse({
      suspectedOperationQuote: narrationText.includes('复制移动') ? '复制移动' : null
    })
  }
  if (r.messages.some((m) => m.role === 'system'))
    return r.stream ? makeStream(!interrupt) : jsonResponse(narrationText)
  return jsonResponse(
    r.messages[0]?.content?.includes('局部内容读到') ? '图片右侧的水鸟' : '一只水鸟。'
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
  assert.equal(result.result.primaryRegionId, 'region-real')
  assert.deepEqual(result.result.regionAnalyses[0].evidenceIds, ['region-evidence'])
  assert.equal(result.result.regionAnalyses[0].suspectedOperation, '复制移动')
  assert.equal(result.result.regionAnalyses[0].operationSource, 'vlm_hypothesis')
  assert.deepEqual(validateExplanationReport(result, [manipulation]), [])
  assert.equal(result.result.analysis, finalText)
  assert.equal(typeof result.result.lead, 'string')
  assert.equal(requests.length, 6)
  const guidance = requests.find(
    (r) => r.format?.properties?.focusIndex && !r.format.properties.decision
  )
  const assessment = requests.find((r) => r.format?.properties?.decision)
  const narration = requests.find((r) => !r.format && r.messages.some((m) => m.role === 'system'))
  const observation = requests.find(
    (r) =>
      !r.format &&
      !r.messages.some((m) => m.role === 'system') &&
      !r.messages[0].content.includes('局部内容读到')
  )
  const user = (r) => r.messages.find((m) => m.role === 'user')
  assert.equal(user(guidance).images.length, 1)
  assert.notDeepEqual(Buffer.from(user(guidance).images[0], 'base64'), png)
  assert.deepEqual(
    Buffer.from(user(assessment).images[0], 'base64'),
    png,
    'Image judgement must receive the unmarked original'
  )
  assert.deepEqual(
    Buffer.from(user(observation).images.at(-1), 'base64'),
    png,
    'The raw context crop has no artificial contour'
  )
  const context = JSON.parse(user(assessment).content)
  assert.equal(context.annotation, undefined)
  assert.equal(context.images, undefined)
  assert.equal(context.candidates[0].support.value, 0.88)
  assert.ok(context.candidates[0].content.includes('一只水鸟。'))
  assert.equal(context.candidates[0].context, null)
  assert.equal(user(narration).images, undefined)
  assert.ok(!user(narration).content.includes('0.88'))
  assert.ok(!user(narration).content.includes('青色'))
  assert.ok(user(narration).content.includes('水鸟'))
  assert.ok(user(narration).content.includes('较强'))
  assert.equal(result.extensions.inputPresentation.narration.imageCount, 0)
  assert.equal(result.extensions.rawNarratives[0].message.content, finalText)
  assert.equal(result.extensions.visualGuidance.status, 'completed')
  assert.equal(result.extensions.inputPresentation.forStage, 'visual_guidance')
  assert.equal(result.extensions.inputPresentation.assessment.type, 'unmarked_original')
  assert.equal(result.extensions.regionSelection.presentedCount, 1)
  checks.push(
    'context links full-scene contours to untouched crops; assessment sees original pixels; narration uses contextual targets and three-way method hypotheses'
  )
  const documentRegion = { ...manipulation.result.regions[0], detector: 'rise' }
  for (const limit of [1, 2]) {
    const before = requests.length
    const observed = await observeRegions({
      directory,
      full: png,
      regions: [documentRegion],
      artifacts: bundle.artifacts,
      model: 'fixture',
      host: 'http://127.0.0.1:11434',
      numCtx: 8192,
      maxImages: limit
    })
    assert.equal(observed[0].status, 'completed')
    assert.equal(observed[0].inputImageCount, limit)
    const sent = user(requests[before]).images
    assert.equal(sent.length, 1)
    assert.deepEqual(Buffer.from(sent[0], 'base64'), png)
    if (limit > 1) {
      const sceneRequest = requests[before + 1]
      assert.equal(user(sceneRequest).images.length, 2)
      assert.deepEqual(Buffer.from(user(sceneRequest).images[0], 'base64'), png)
      assert.deepEqual(Buffer.from(user(sceneRequest).images[1], 'base64'), png)
    }
  }
  checks.push(
    'scene-assisted observation preserves crop pixels and respects its per-request image limit'
  )
  await writeFile(
    join(output, 'request.json'),
    JSON.stringify(
      requests.map((r) => ({
        ...r,
        messages: r.messages.map((m) => ({
          ...m,
          images: m.images?.map(() => '<actual synthetic image bytes>')
        }))
      })),
      null,
      2
    )
  )
  const events = []
  const streamed = await generateExplanation(
    bundle,
    taskId,
    'fixture-model',
    'http://127.0.0.1:11434',
    { onProgress: (e) => events.push(e) }
  )
  assert.equal(streamed.result.analysis, finalText)
  assert.ok(events.some((e) => e.text && e.text.length > 1 && e.text.length < finalText.length))
  metadataFails = true
  const retained = await generateExplanation(
    bundle,
    taskId,
    'fixture-model',
    'http://127.0.0.1:11434',
    { onProgress() {} }
  )
  assert.equal(retained.mode, 'local')
  assert.equal(retained.result.analysis, finalText)
  assert.equal(retained.extensions.structuredExtraction, 'failed')
  assert.equal(retained.result.finalDecision, 'suspicious')
  assert.equal(retained.result.decisionSource, 'vlm')
  assert.equal(retained.result.primaryRegionId, 'region-real')
  assert.equal(retained.result.regionAnalyses[0].suspectedOperation, '暂不能区分')
  metadataFails = false
  verdict = '未发现明显异常'
  narrationText = '本次没有明确异常线索。'
  const independent = await generateExplanation(
    bundle,
    taskId,
    'fixture-model',
    'http://127.0.0.1:11434'
  )
  assert.equal(independent.result.finalDecision, 'no_anomaly_detected')
  assert.equal(independent.result.primaryRegionId, null)
  assert.equal(independent.result.analysis, narrationText)
  verdict = '存在可疑线索'
  narrationText = finalText
  interrupt = true
  const interrupted = await generateExplanation(
    bundle,
    taskId,
    'fixture-model',
    'http://127.0.0.1:11434',
    { onProgress() {} }
  )
  assert.equal(interrupted.mode, 'mock')
  assert.equal(interrupted.extensions.rawNarratives[0].incomplete, true)
  assert.equal(interrupted.extensions.rawNarratives[0].message.content, finalText)
  checks.push(
    'streamed prose is unchanged; optional method failure preserves the VLM judgement; independent negative decisions and interrupted raw replies remain visible'
  )
  const callsBefore = requests.length
  const tiny = await observeRegions({
    directory,
    full: png,
    regions: [{ ...manipulation.result.regions[0], bboxXYWH: [1, 1, 3, 3] }],
    artifacts: bundle.artifacts,
    model: 'fixture',
    host: 'http://127.0.0.1:11434',
    numCtx: 8192
  })
  assert.equal(tiny[0].status, 'skipped')
  assert.equal(tiny[0].text, undefined)
  assert.equal(requests.length, callsBefore)
  unavailable = true
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
  const fallback = await generateExplanation(
    bundle,
    taskId,
    'fixture-model',
    'http://127.0.0.1:11434'
  )
  assert.equal(fallback.mode, 'mock')
  assert.equal(fallback.result.decisionSource, 'rule_fallback')
  assert.deepEqual(validateExplanationReport(fallback, [manipulation]), [])
  checks.push(
    'tiny regions do not invent semantic content; unavailable model returns a marked fallback without changing detector evidence'
  )
} finally {
  globalThis.fetch = originalFetch
  if (previous === undefined) delete process.env.SRDP_EXPLANATION_CONFIG
  else process.env.SRDP_EXPLANATION_CONFIG = previous
}
await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2))
console.log(JSON.stringify({ passed: true, checks }, null, 2))
