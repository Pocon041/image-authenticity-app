import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'rolldown'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'work/protocol-tests')
await mkdir(output, { recursive: true })
await build({
  input: join(root, 'src/shared/protocol.ts'),
  platform: 'node',
  external: ['ajv', 'ajv-formats'],
  output: { file: join(output, 'protocol.mjs'), format: 'esm' }
})
const { validateEvidenceBundle, validateExplanationReport, assertEvidenceBundle } = await import(
  pathToFileURL(join(output, 'protocol.mjs'))
)
const checks = []
const imageId = `sha256:${'a'.repeat(64)}`
const base = {
  schemaVersion: '1.0',
  reportId: 'upstream-manipulation',
  imageId,
  taskId: 'task-input',
  mode: 'local',
  status: 'completed',
  producer: { name: 'TEST FIXTURE', version: 'test-only' },
  createdAt: '2026-10-28T00:00:00Z',
  elapsedMs: 1,
  inputReportIds: [],
  evidence: [
    {
      evidenceId: 'evidence-1',
      kind: 'test_fixture',
      origin: 'measured',
      description: 'Synthetic structure fixture only',
      regionId: null,
      artifactIds: [],
      data: {},
      limitation: 'No model inference'
    }
  ],
  artifacts: [],
  limitations: ['No model inference'],
  error: null
}
const upstream = {
  ...base,
  moduleId: 'manipulation',
  result: { decision: 'inconclusive', score: null, regions: [], operationHints: [] }
}
const explanation = {
  ...base,
  reportId: 'explanation-test',
  taskId: 'task-output',
  moduleId: 'explanation',
  mode: 'mock',
  inputReportIds: [upstream.reportId],
  evidence: [],
  result: {
    finalDecision: 'inconclusive',
    confidence: { source: 'unavailable', value: null, calibrated: false },
    analysis: 'Test explanation, no VLM invoked.',
    claims: [{ text: 'Test claim with an upstream citation.', evidenceIds: ['evidence-1'] }],
    unresolved: ['Test fixture only']
  }
}
assert.deepEqual(validateExplanationReport(explanation, [upstream]), [])
const failed = {
  ...explanation,
  status: 'failed',
  result: null,
  error: { code: 'TEST', message: 'Deliberate test failure' }
}
assert.deepEqual(validateExplanationReport(failed, [upstream]), [])
checks.push('valid completed and failed explanations conform to the shared v1.0 schema')

for (const value of [
  null,
  undefined,
  {},
  [],
  { ...explanation, status: 'other' },
  { ...explanation, evidence: null },
  { ...explanation, result: { ...explanation.result, claims: null } },
  { ...explanation, result: { ...explanation.result, confidence: null } },
  { ...explanation, result: null },
  { ...failed, error: null }
]) {
  assert.ok(validateExplanationReport(value).length > 0)
}
checks.push('malformed JSON returns validation errors instead of throwing')

for (const confidence of [
  { source: 'unavailable', value: 0.5, calibrated: false },
  { source: 'vlm_self_assessment', value: 0.8, calibrated: true },
  { source: 'calibrated_fusion', value: 0.8, calibrated: false },
  { source: 'vlm_self_assessment', value: NaN, calibrated: false },
  { source: 'other', value: null, calibrated: false }
]) {
  assert.ok(
    validateExplanationReport({ ...explanation, result: { ...explanation.result, confidence } })
      .length > 0
  )
}
checks.push('confidence source, calibration and finite numeric range follow the schema')

assert.ok(validateExplanationReport(explanation, []).some((error) => error.includes('unknown')))
assert.deepEqual(validateExplanationReport(explanation), [])
assert.ok(
  validateExplanationReport(
    {
      ...explanation,
      result: {
        ...explanation.result,
        claims: [{ text: 'Unresolved citation', evidenceIds: ['missing-id'] }]
      }
    },
    [upstream]
  ).some((error) => error.includes('unknown evidenceId'))
)
assert.ok(
  validateExplanationReport({
    ...explanation,
    result: { ...explanation.result, claims: [{ text: '', evidenceIds: [] }] }
  }).length > 0
)
checks.push(
  'explicit empty upstream input, missing reports and unresolved or empty citations are rejected'
)

assert.ok(
  validateExplanationReport(explanation, [
    { ...upstream, imageId: `sha256:${'b'.repeat(64)}` }
  ]).some((error) => error.includes('imageId mismatch'))
)
assert.ok(
  validateExplanationReport(explanation, [upstream, upstream]).some((error) =>
    error.includes('ambiguous')
  )
)
assert.ok(
  validateExplanationReport({ ...explanation, inputReportIds: [explanation.reportId] }, [
    upstream
  ]).some((error) => error.includes('itself'))
)
checks.push('cross-image, duplicate identity and self references are rejected')

const mixed = {
  ...explanation,
  mode: 'local',
  limitations: ['Input contains mock evidence; inference alone does not make it measured.']
}
assert.deepEqual(validateExplanationReport(mixed, [{ ...upstream, mode: 'mock' }]), [])
checks.push('per-report mock/local semantics remain compatible with mixed integration fixtures')

const actualOption = process.argv.indexOf('--bundle')
if (actualOption >= 0) {
  const file = resolve(process.argv[actualOption + 1])
  const actual = JSON.parse(await readFile(file, 'utf8'))
  assert.deepEqual(validateEvidenceBundle(actual), [])
  assertEvidenceBundle(actual)
  const inputs = actual.reports.filter(
    (report) => report.status === 'completed' && report.evidence.length > 0
  )
  assert.ok(inputs.length > 0)
  const sample = {
    ...explanation,
    imageId: actual.image.imageId,
    inputReportIds: inputs.map((input) => input.reportId),
    result: {
      ...explanation.result,
      claims: inputs.map((input) => ({
        text: 'Compatibility fixture citing existing detector evidence; no interpretation was generated.',
        evidenceIds: [input.evidence[0].evidenceId]
      }))
    }
  }
  assert.deepEqual(validateExplanationReport(sample, actual.reports), [])
  const extended = { ...actual, reports: [...actual.reports, sample] }
  assert.deepEqual(validateEvidenceBundle(extended), [])
  checks.push(
    'existing real workflow bundle and synthetic explanation citations interoperate without changing IDs'
  )
}
await writeFile(
  join(output, 'result.json'),
  JSON.stringify(
    { passed: true, checks, scope: 'protocol and citation validation only; no VLM inference' },
    null,
    2
  )
)
console.log(JSON.stringify({ passed: true, checks }, null, 2))
