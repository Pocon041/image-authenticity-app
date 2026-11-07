import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { buildEvidenceLinks } from '../src/main/services/evidence-links.ts'
import { linkAssessment } from '../src/main/services/explanation-evidence.ts'
import { regionContext } from '../src/main/services/visual-observation.ts'
import { generateExplanation } from '../src/main/services/explanation.ts'
import { validateExplanationReport } from '../src/shared/protocol.ts'

const taskId = 'evidence-links-fixture'
const directory = resolve('work/analysis-runs', taskId)
await mkdir(join(directory, 'images'), { recursive: true })
const full = await sharp({ create: { width: 16, height: 12, channels: 3, background: '#4593ce' } })
  .png()
  .toBuffer()
const pixels = Buffer.alloc(16 * 12)
for (let y = 4; y < 12; y++) pixels.fill(255, y * 16, (y + 1) * 16)
const mask = await sharp(pixels, { raw: { width: 16, height: 12, channels: 1 } })
  .png()
  .toBuffer()
await writeFile(join(directory, 'images/display.png'), full)
await writeFile(join(directory, 'images/mask.png'), mask)
const base = {
  schemaVersion: '1.0',
  imageId: `sha256:${'b'.repeat(64)}`,
  taskId,
  mode: 'local',
  status: 'completed',
  createdAt: '2026-11-08T00:00:00Z',
  elapsedMs: 1,
  producer: { name: 'SYNTHETIC FIXTURE', version: 'test-only' },
  inputReportIds: [],
  error: null,
  artifacts: [],
  limitations: []
}
const evidence = (id, detector, kind) => ({
  evidenceId: id,
  kind,
  origin: 'measured',
  description: 'Test only',
  regionId: null,
  artifactIds: [],
  data: { detector },
  limitation: 'Synthetic fixture'
})
const region = {
  regionId: 'water-region',
  detector: 'rita',
  bboxXYWH: [0, 4, 16, 8],
  areaPixels: 128,
  coordinateSpace: 'display_image_pixels',
  maskArtifactId: 'mask'
}
const manipulation = {
  ...base,
  moduleId: 'manipulation',
  reportId: 'manipulation-record',
  evidence: [
    evidence('sica-evidence', 'sica', 'image_classification'),
    evidence('rita-evidence', 'rita', 'model_localization')
  ],
  result: {
    decision: 'inconclusive',
    score: null,
    operationHints: [],
    regions: [region],
    detectors: [
      {
        backend: 'sica',
        status: 'completed',
        result: {
          classification: { predictedClass: 'fake', threshold: 0.5 },
          score: { value: 0.8665 }
        }
      },
      {
        backend: 'rita',
        status: 'completed',
        result: { regionCount: 1, confidence: { value: 0.92 } }
      }
    ]
  }
}
const aigc = {
  ...base,
  moduleId: 'aigc',
  reportId: 'fsd-record',
  evidence: [evidence('fsd-evidence', 'aigc', 'aigc_classification')],
  result: {
    decision: 'non_ai',
    threshold: -2,
    clues: [],
    score: { name: 'fsd_z_score', value: 0.29678, positiveClass: 'ai_generated', calibrated: false }
  }
}
const links = buildEvidenceLinks(manipulation, aigc)
assert.ok(
  links.some((link) => link.relation === 'corroborates' && link.question === 'local_editing')
)
assert.ok(links.some((link) => link.relation === 'different_tasks' && link.models.includes('aigc')))
assert.ok(!links.some((link) => link.relation === 'different_findings'))
const unknownVisual = {
  decision: 'inconclusive',
  focusIndex: null,
  targetDescription: '',
  operation: 'unknown',
  operationReason: '',
  operationEvidence: 'none'
}
const candidates = [
  { regionId: 'A', sourceRegionId: 'water-region', location: '图片下方', observedContent: '水面' }
]
assert.equal(linkAssessment(unknownVisual, links, candidates).decision, 'suspicious')
assert.equal(linkAssessment(unknownVisual, links, candidates).visualDecision, 'inconclusive')
const negative = structuredClone(manipulation)
negative.result.detectors[0].result.classification.predictedClass = 'real'
negative.result.detectors[0].result.score.value = 0.01
negative.result.detectors[1].result.confidence = { value: 0.999999 }
assert.ok(!buildEvidenceLinks(negative, aigc).some((link) => link.relation === 'corroborates'))
assert.equal(
  linkAssessment(unknownVisual, buildEvidenceLinks(negative, aigc), candidates).decision,
  'inconclusive'
)
const failed = structuredClone(manipulation)
failed.result.detectors[1].status = 'failed'
assert.ok(!buildEvidenceLinks(failed, aigc).some((link) => link.relation === 'corroborates'))
assert.deepEqual(buildEvidenceLinks({ ...manipulation, mode: 'mock' }, undefined), [])
const missingEvidence = structuredClone(manipulation)
missingEvidence.evidence = missingEvidence.evidence.filter(
  (entry) => entry.data.detector !== 'sica'
)
assert.ok(
  !buildEvidenceLinks(missingEvidence, aigc).some((link) => link.relation === 'corroborates')
)
const regionalConfidence = structuredClone(manipulation)
delete regionalConfidence.result.detectors[1].result.confidence
regionalConfidence.result.regions[0].confidence = { value: 0.91 }
assert.ok(buildEvidenceLinks(regionalConfidence, aigc).some((link) => link.strength === 'strong'))

const crop = await regionContext(full, mask, region)
assert.deepEqual(crop.bbox, region.bboxXYWH)
assert.deepEqual(
  await sharp(crop.bytes).raw().toBuffer(),
  await sharp(full).extract({ left: 0, top: 4, width: 16, height: 8 }).raw().toBuffer()
)

const bundle = {
  image: { imageId: base.imageId, displayArtifactId: 'display', width: 16, height: 12 },
  reports: [manipulation, aigc],
  artifacts: [
    {
      artifactId: 'display',
      type: 'display',
      uri: 'images/display.png',
      sourceArtifactId: 'original'
    },
    { artifactId: 'mask', type: 'mask', uri: 'images/mask.png', sourceArtifactId: 'display' }
  ]
}
const before = JSON.stringify(bundle)
const requests = []
const nativeFetch = globalThis.fetch
globalThis.fetch = async (_url, options) => {
  const request = JSON.parse(options.body)
  requests.push(request)
  let content
  if (request.format?.properties?.subject && request.format?.properties?.operation)
    content = { subject: '水面', operation: 'unknown', reason: '尚不能区分' }
  else if (request.format?.properties?.subject) content = { subject: '水面' }
  else if (request.format?.properties?.operation)
    content = { operation: 'unknown', reason: '尚不能区分', evidenceType: 'none' }
  else if (request.format?.properties?.focusIndex && !request.format?.properties?.decision)
    content = { focusIndex: 1 }
  else throw new Error('Linked facts must not be reclassified or rewritten by a free-form model')
  return new Response(
    JSON.stringify({ done_reason: 'stop', message: { content: JSON.stringify(content) } })
  )
}
try {
  const report = await generateExplanation(bundle, taskId, 'fixture', 'http://127.0.0.1:11434')
  assert.equal(report.mode, 'local')
  assert.equal(report.result.decisionSource, 'evidence_fusion')
  assert.equal(report.result.localManipulation, 'supported')
  assert.equal(report.result.finalDecision, 'suspicious')
  assert.match(report.result.lead, /水面/)
  assert.match(report.result.lead, /存在明确的局部篡改/)
  assert.match(report.result.analysis, /SICA.*发现/)
  assert.match(report.result.analysis, /FSD未检出AI生成/)
  assert.ok(!report.result.analysis.includes('检测器关系已确定'))
  assert.equal(report.result.confidence.value, null)
  assert.equal(report.producer.name, 'linked-evidence-summary')
  assert.equal(requests.length, 3)
  assert.deepEqual(report.extensions.rawNarratives, [])
  assert.match(report.extensions.narrationFacts, /检测关系汇总依据/)
  assert.equal(report.extensions.inputPresentation.assessment.type, 'linked_detection_records')
  assert.equal(report.extensions.inputPresentation.assessment.imageCount, 0)
  assert.equal(
    report.extensions.rawJudgements.some((entry) => entry.stage === 'original_assessment'),
    false
  )
  assert.equal(report.extensions.visualObservations[0].observationStrategy, 'predicted_region_crop')
  assert.deepEqual(validateExplanationReport(report, bundle.reports), [])
  const broken = structuredClone(report)
  broken.result.evidenceLinks[0].evidenceIds.push('missing-evidence')
  assert.ok(
    validateExplanationReport(broken, bundle.reports).some((error) =>
      error.includes('evidence link references unknown evidenceId')
    )
  )
  assert.equal(JSON.stringify(bundle), before)
  const aiPositive = structuredClone(bundle)
  aiPositive.reports[1].result.decision = 'ai_generated'
  aiPositive.reports[1].result.score.value = -6
  const mixed = await generateExplanation(aiPositive, taskId, 'fixture', 'http://127.0.0.1:11434')
  assert.equal(mixed.result.aiGeneration, 'supported')
  assert.equal(mixed.result.localManipulation, 'uncertain')
  assert.ok(
    mixed.result.evidenceLinks.some(
      (link) => link.relation === 'corroborates' && link.question === 'image_anomaly'
    )
  )
  assert.ok(
    !mixed.result.evidenceLinks.some(
      (link) => link.relation === 'corroborates' && link.question === 'local_editing'
    )
  )
  assert.ok(!mixed.result.lead.includes('局部篡改'))
  assert.match(mixed.result.analysis, /整图生成/)
  globalThis.fetch = async () => {
    throw new Error('Synthetic offline VLM')
  }
  const offline = await generateExplanation(bundle, taskId, 'fixture', 'http://127.0.0.1:11434')
  assert.equal(offline.mode, 'local')
  assert.equal(offline.producer.name, 'linked-evidence-summary')
  assert.equal(offline.result.finalDecision, 'suspicious')
  assert.ok(!offline.result.lead.includes('水面'))
  assert.deepEqual(validateExplanationReport(offline, bundle.reports), [])
} finally {
  globalThis.fetch = nativeFetch
}
console.log(
  'Evidence links: task-specific agreement and differences, unavailable/missing/mock inputs, no confidence ranking, untouched region crops, linked conclusions, fewer model calls, evidence references and unchanged native outputs passed.'
)
