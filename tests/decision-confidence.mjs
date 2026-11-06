import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'
import Ajv from 'ajv'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'work/decision-confidence-test')
await mkdir(output, { recursive: true })
for (const [name, input] of [
  ['confidence', 'src/shared/decision-confidence.ts'],
  ['explanation', 'src/main/services/explanation.ts']
]) {
  await build({
    input: join(root, input),
    platform: 'node',
    external: ['ajv', 'ajv-formats'],
    output: { file: join(output, `${name}.mjs`), format: 'esm' }
  })
}
const {
  sicaDecisionConfidence: sica,
  fsdDecisionConfidence: fsd,
  sicaClassSupport,
  fsdClassSupport
} = await import(pathToFileURL(join(output, 'confidence.mjs')))
const { generateExplanation } = await import(pathToFileURL(join(output, 'explanation.mjs')))
const checks = []
assert.equal(sica(0.5, 0.5).value, 0)
assert.equal(fsd(-2, -2).value, 0)
assert.equal(sica(0, 0.5).value, 1)
assert.equal(sica(1, 0.5).value, 1)
assert.equal(sica(0.2, 0.2).value, 0)
assert.equal(sica(0, 0).value, 0)
assert.equal(sica(1, 1).value, 0)
assert.equal(sica(0.6, 0.2).value, (0.6 - 0.2) / 0.8)
assert.ok(sica(0.1, 0.5).value > sica(0.4, 0.5).value)
assert.ok(sica(0.9, 0.5).value > sica(0.6, 0.5).value)
assert.ok(fsd(-5, -2).value > fsd(-3, -2).value)
assert.ok(fsd(1, -2).value > fsd(-1, -2).value)
for (const bad of [undefined, null, NaN, Infinity, '0.5']) {
  assert.equal(sica(bad, 0.5), null)
  assert.equal(fsd(bad, -2), null)
  assert.equal(sica(0.4, bad), null)
  assert.equal(fsd(0.4, bad), null)
}
assert.equal(sica(-0.1, 0.5), null)
assert.equal(sica(0.4, 1.1), null)
assert.equal(fsd(-Number.MAX_VALUE, Number.MAX_VALUE), null)
checks.push(
  'both score directions are monotonic; exact/endpoint thresholds and unavailable inputs are handled'
)

const measuredSica = sica(0.324358731508255, 0.5)
const measuredFsd = fsd(-0.016486665496319393, -2)
const sicaSupport = sicaClassSupport(0.324358731508255, 'real')
const fsdSupport = fsdClassSupport(-0.016486665496319393, -2, 'non_ai')
assert.equal(sicaSupport.value, 1 - 0.324358731508255)
assert.equal(sicaClassSupport(0.9, 'real').value, 1 - 0.9)
assert.equal(sicaClassSupport(0.9, 'fake').value, 0.9)
assert.equal(sicaClassSupport(0.9, 'inconclusive'), null)
assert.equal(fsdClassSupport(-0.1, -2, 'inconclusive'), null)
assert.equal(fsdSupport.value, measuredFsd.value)
assert.ok(Math.abs(measuredSica.value - 0.35128253698349) < 1e-12)
assert.ok(measuredFsd.value > 0.66 && measuredFsd.value < 0.67)
const schema = JSON.parse(await readFile(join(root, 'schemas/report-bundle.schema.json'), 'utf8'))
const concise = JSON.parse(
  await readFile(join(root, 'schemas/manipulation-summary.schema.json'), 'utf8')
)
assert.deepEqual(schema.$defs.decisionConfidence, concise.$defs.decisionConfidence)
assert.deepEqual(schema.$defs.modelSupport, concise.$defs.modelSupport)
const validateSupport = new Ajv({ strict: false }).compile(schema.$defs.modelSupport)
assert.equal(validateSupport(sicaSupport), true)
assert.equal(validateSupport(fsdSupport), true)
assert.equal(validateSupport({ ...sicaSupport, value: 1.1 }), false)
assert.equal(validateSupport({ ...sicaSupport, calibrated: true }), false)
const validate = new Ajv({ strict: false }).compile(schema.$defs.decisionConfidence)
assert.equal(validate(measuredSica), true)
assert.equal(validate(measuredFsd), true)
assert.equal(validate(null), true)
assert.equal(validate({ ...measuredSica, value: 1.1 }), false)
assert.equal(validate({ ...measuredSica, calibrated: true }), false)
assert.equal(validate({ ...measuredSica, comparableAcrossModels: true }), false)
checks.push(
  'real saved scores produce bounded non-probability values; both schemas reject calibration/comparability claims'
)

const base = {
  schemaVersion: '1.0',
  imageId: `sha256:${'a'.repeat(64)}`,
  taskId: 'confidence-fixture',
  mode: 'local',
  status: 'completed',
  producer: { name: 'TEST FIXTURE', version: 'test-only' },
  createdAt: '2026-11-04T00:00:00Z',
  elapsedMs: 1,
  inputReportIds: [],
  artifacts: [],
  limitations: ['Synthetic transport test'],
  error: null
}
const evidence = (id, kind) => ({
  evidenceId: id,
  kind,
  origin: 'measured',
  description: 'Synthetic transport fixture only',
  regionId: null,
  artifactIds: [],
  data: {},
  limitation: 'Not real inference'
})
const manipulation = {
  ...base,
  reportId: 'manipulation-test',
  moduleId: 'manipulation',
  result: {
    decision: 'inconclusive',
    score: null,
    regions: [
      {
        regionId: 'region-A',
        detector: 'rita',
        bboxXYWH: [1, 1, 2, 2],
        coordinateSpace: 'display_image_pixels',
        maskArtifactId: null,
        confidence: {
          value: 0.88,
          description: 'Synthetic pixel support',
          target: 'marked_region_pixels',
          source: 'mean_tamper_response',
          calibrated: false,
          comparableAcrossModels: false
        }
      }
    ],
    operationHints: [],
    detectors: [
      {
        backend: 'sica',
        status: 'completed',
        result: {
          score: { value: 0.324358731508255 },
          classification: { predictedClass: 'real', threshold: 0.5 }
        }
      },
      { backend: 'rita', status: 'completed', result: { regionCount: 1, areaFraction: 0.0458 } }
    ]
  },
  evidence: [
    evidence('sica-test', 'image_classification'),
    {
      ...evidence('rita-test', 'model_localization'),
      regionId: 'region-A',
      data: { detector: 'rita' }
    }
  ]
}
const aigc = {
  ...base,
  reportId: 'aigc-test',
  moduleId: 'aigc',
  result: {
    decision: 'non_ai',
    score: {
      name: 'fsd_z_score',
      value: -0.016486665496319393,
      positiveClass: 'ai_generated',
      calibrated: false
    },
    threshold: -2,
    clues: []
  },
  evidence: [evidence('fsd-test', 'aigc_classification')]
}
const originalFetch = globalThis.fetch
let captured, narrativeRequest, assessmentRequest
globalThis.fetch = async (url, options) => {
  assert.ok(String(url).endsWith('/api/chat'))
  captured = JSON.parse(options.body)
  let content
  if (captured.format?.properties?.decision) {
    assessmentRequest = captured
    content = JSON.stringify({ decision: '存在可疑线索', focusIndex: 1 })
  } else if (captured.format?.properties?.focusIndex) content = JSON.stringify({ focusIndex: 1 })
  else if (captured.format) content = JSON.stringify({ suspectedOperationQuote: null })
  else {
    narrativeRequest = captured
    content = '这是合成测试返回的分区说明，仅用于检查传输，不代表实际推理或检测结果。'
  }
  return new Response(JSON.stringify({ done_reason: 'stop', message: { content } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}
try {
  const report = await generateExplanation(
    { image: { imageId: base.imageId }, reports: [manipulation, aigc], artifacts: [] },
    'confidence-fixture',
    'test-local-model',
    'http://127.0.0.1:11434'
  )
  const prompt = assessmentRequest.messages.find((m) => m.role === 'user').content
  const context = JSON.parse(prompt)
  assert.equal(narrativeRequest.messages.find((m) => m.role === 'user').images, undefined)
  assert.equal(
    context.models.find((i) => i.model === 'SICA').support.value,
    Number(sicaSupport.value.toFixed(4))
  )
  assert.equal(
    context.models.find((i) => i.model === 'FSD').support.value,
    Number(fsdSupport.value.toFixed(4))
  )
  assert.equal(context.models.find((i) => i.model === 'RITA').regions[0].support.value, 0.88)
  assert.equal(context.models.find((i) => i.model === 'RiSE').support, null)
  assert.equal(context.models.find((i) => i.model === 'RiSE').finding, '本轮未运行或未完成')
  assert.ok(!prompt.includes('必须说明的限制'))
  assert.equal(report.result.finalDecision, 'suspicious')
  assert.equal(report.result.upstreamDecision, 'inconclusive')
  assert.equal(report.result.decisionSource, 'vlm')
  assert.equal(report.result.regionAnalyses[0].regionId, 'region-A')
  assert.deepEqual(report.result.regionAnalyses[0].evidenceIds, ['rita-test'])
  assert.equal(report.result.confidence.value, null)
  assert.equal(manipulation.result.detectors[0].result.classification.threshold, 0.5)
  assert.equal(aigc.result.threshold, -2)
} finally {
  globalThis.fetch = originalFetch
}
checks.push(
  'original assessment receives native JSON confidence; narration receives only facts; detector thresholds and final numeric confidence remain unchanged'
)
console.log(
  JSON.stringify({ passed: true, checks, example: { sica: sicaSupport, fsd: fsdSupport } }, null, 2)
)
