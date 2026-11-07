// Structural and source-routing checks; no detector or VLM accuracy claims.
import assert from 'node:assert/strict'
import { sourceConclusion } from '../src/main/services/source-conclusion.ts'
import { generateExplanation } from '../src/main/services/explanation.ts'
import { validateExplanationReport } from '../src/shared/protocol.ts'

const imageId = `sha256:${'a'.repeat(64)}`
const base = {
  schemaVersion: '1.0',
  imageId,
  taskId: 'source-conclusion-test',
  mode: 'local',
  status: 'completed',
  producer: { name: 'SYNTHETIC TEST', version: 'test-only' },
  createdAt: '2026-11-08T00:00:00Z',
  elapsedMs: 1,
  inputReportIds: [],
  evidence: [],
  artifacts: [],
  limitations: [],
  error: null
}
const source = {
  ...base,
  moduleId: 'provenance',
  reportId: 'source-record',
  result: {
    preprocessing: { originalPreserved: true, displayTransform: 'exif_auto_orient_no_resize' },
    metadata: { status: 'completed', details: {} },
    credentials: {
      status: 'completed',
      details: {
        outcome: 'manifest_container_found',
        reader: {
          status: 'completed',
          validationState: 'Invalid',
          aiDeclaration: 'declared_ai_generated_or_composited',
          claimGeneratorInfo: [{ name: 'Example Source' }],
          validationChecks: {
            claimSignature: 'passed',
            contentBinding: 'passed',
            signerTrust: 'untrusted'
          },
          actions: [
            { action: 'c2pa.created', softwareAgent: { name: 'Example Generator', version: '1.0' } }
          ]
        }
      }
    },
    watermark: { status: 'completed', details: {} }
  },
  evidence: [
    {
      evidenceId: 'source-evidence',
      kind: 'c2pa_manifest_presence',
      origin: 'measured',
      description: 'Synthetic source record',
      regionId: null,
      artifactIds: [],
      data: {},
      limitation: 'Test only'
    }
  ]
}
const aigc = {
  ...base,
  moduleId: 'aigc',
  reportId: 'aigc-record',
  evidence: [
    {
      evidenceId: 'aigc-evidence',
      kind: 'aigc_classification',
      origin: 'measured',
      description: 'Synthetic FSD result',
      regionId: null,
      artifactIds: [],
      data: {},
      limitation: 'Test only'
    }
  ],
  result: {
    decision: 'ai_generated',
    threshold: -2,
    clues: [],
    score: { name: 'fsd_z_score', value: -10, positiveClass: 'ai_generated', calibrated: false }
  }
}
const manipulation = {
  ...base,
  moduleId: 'manipulation',
  reportId: 'local-record',
  result: {
    decision: 'inconclusive',
    score: null,
    regions: [],
    operationHints: [],
    detectors: [
      {
        backend: 'sica',
        status: 'completed',
        result: {
          classification: { predictedClass: 'real', threshold: 0.5 },
          score: { value: 0.01 }
        }
      },
      {
        backend: 'rita',
        status: 'failed',
        error: { code: 'INFERENCE_FAILED', message: 'Synthetic failure' }
      }
    ]
  }
}
const bundle = {
  image: { imageId, width: 16, height: 12 },
  reports: [manipulation, source, aigc],
  artifacts: []
}
const before = JSON.stringify(bundle)
const fetchBefore = globalThis.fetch
globalThis.fetch = async () => {
  throw new Error('Source summaries must not invoke a model')
}
try {
  const report = await generateExplanation(
    bundle,
    'source-conclusion-test',
    'fixture',
    'http://127.0.0.1:11434',
    { releaseModel: true }
  )
  assert.equal(report.mode, 'local')
  assert.equal(report.result.decisionSource, 'evidence_fusion')
  assert.equal(report.result.aiGenerationSource, 'credentials')
  assert.equal(report.result.aiGeneration, 'supported')
  assert.equal(report.result.localManipulation, 'uncertain')
  assert.equal(report.result.finalDecision, 'suspicious')
  assert.ok(
    report.result.evidenceLinks.some(
      (link) => link.relation === 'corroborates' && link.question === 'ai_generation'
    )
  )
  assert.match(report.result.lead, /Example Generator\/1.0.*FSD.*相互印证/)
  assert.ok(!report.result.lead.includes('暂不能确定'))
  assert.deepEqual(report.result.regionAnalyses, [])
  assert.deepEqual(report.extensions.rawNarratives, [])
  assert.equal(report.extensions.inputPresentation.imageCount, 0)
  assert.equal(report.extensions.structuredExtraction, 'not_run')
  assert.ok(report.result.claims.some((claim) => claim.evidenceIds.includes('source-evidence')))
  assert.deepEqual(validateExplanationReport(report, bundle.reports), [])
  assert.equal(JSON.stringify(bundle), before)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    generateExplanation(bundle, 'cancelled-source', 'fixture', 'http://127.0.0.1:11434', {
      signal: controller.signal
    })
  )
} finally {
  globalThis.fetch = fetchBefore
}

for (const [key, value] of [
  ['claimSignature', 'failed'],
  ['contentBinding', 'failed'],
  ['contentBinding', 'unknown']
]) {
  const broken = structuredClone(source)
  broken.result.credentials.details.reader.validationChecks[key] = value
  assert.equal(sourceConclusion(broken, aigc), null)
}
for (const key of ['claimSignature', 'contentBinding']) {
  const incomplete = structuredClone(source)
  delete incomplete.result.credentials.details.reader.validationChecks[key]
  assert.equal(sourceConclusion(incomplete, aigc), null)
}
assert.equal(sourceConclusion({ ...source, mode: 'mock' }, aigc), null)
for (const status of ['failed', 'not_run']) {
  const unread = structuredClone(source)
  unread.result.credentials.details.reader.status = status
  assert.equal(sourceConclusion(unread, aigc), null)
  assert.equal(sourceConclusion({ ...source, status }, aigc), null)
}
const noDeclaration = structuredClone(source)
delete noDeclaration.result.credentials.details.reader.aiDeclaration
assert.equal(sourceConclusion(noDeclaration, aigc), null)
const nonAi = { ...aigc, result: { ...aigc.result, decision: 'non_ai' } }
assert.match(sourceConclusion(source, nonAi).lead, /未检出AI生成线索/)
assert.ok(!sourceConclusion(source, nonAi).lead.includes('相互印证'))
assert.ok(!sourceConclusion(source, { ...aigc, mode: 'mock' }).lead.includes('相互印证'))
assert.ok(!sourceConclusion(source, undefined).lead.includes('FSD'))
const noActions = structuredClone(source)
delete noActions.result.credentials.details.reader.actions
assert.match(sourceConclusion(noActions, aigc).lead, /Example Source/)
assert.equal(sourceConclusion(undefined, aigc), null)
console.log(
  'Source conclusion: signed and file-bound AI declarations, FSD agreement/disagreement/missing, certificate trust separation, local failure independence, offline summary, cancellation, report references and input immutability passed.'
)
