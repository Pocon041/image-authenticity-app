import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { generateExplanation } from '../src/main/services/explanation.ts'
import { validateEvidenceBundle } from '../src/shared/protocol.ts'

const args = process.argv.slice(2)
if (args.includes('--help') || !args.length) {
  console.log(
    'Usage: run.cmd run vlm:evaluate -- --cases <local.json> [--model <tag>] [--host <url>]'
  )
  console.log(
    'Cases: [{"name":"case-1","bundle":"D:/SRDP/work/analysis-runs/<task>/bundle.json","reference":{}}]'
  )
  console.log(
    'Reuses saved detector results; invokes the VLM only. Results and actual requests stay in work/vlm-evaluations/.'
  )
  process.exit(0)
}
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}
const manifestPath = option('--cases')
if (!manifestPath) throw new Error('--cases is required')
const root = resolve(import.meta.dirname, '..')
process.chdir(root)
const cases = JSON.parse(await readFile(resolve(manifestPath), 'utf8'))
if (!Array.isArray(cases) || !cases.length) throw new Error('Cases must be a nonempty array')
const runId = `vlm-eval-${Date.now()}`
const output = join(root, 'work/vlm-evaluations', runId)
await mkdir(output, { recursive: true })
const save = (name, value) => writeFile(join(output, name), JSON.stringify(value, null, 2))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const originalFetch = globalThis.fetch
const results = []
for (const [index, item] of cases.entries()) {
  if (typeof item.bundle !== 'string') throw new Error(`Case ${index + 1} has no bundle path`)
  const source = resolve(item.bundle)
  const sourceBytes = await readFile(source)
  const bundle = JSON.parse(sourceBytes.toString('utf8'))
  const errors = validateEvidenceBundle(bundle)
  if (errors.length) throw new Error(`Invalid case ${index + 1}: ${errors.join('; ')}`)
  const taskId = `${runId}-${index + 1}`
  const taskDirectory = join(root, 'work/analysis-runs', taskId)
  await cp(dirname(source), taskDirectory, { recursive: true, force: false, errorOnExist: true })
  // Existing explanations and reference labels are never inputs to the new run.
  bundle.reports = bundle.reports.filter((report) => report.moduleId !== 'explanation')
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) })
    return originalFetch(url, options)
  }
  const name = typeof item.name === 'string' ? item.name : `case-${index + 1}`
  console.log(`Analyzing ${index + 1}/${cases.length}: ${name}`)
  const started = performance.now()
  try {
    const report = await generateExplanation(
      bundle,
      taskId,
      option('--model', 'srdp-qwen3-vl-2b'),
      option('--host', 'http://127.0.0.1:11434')
    )
    await save(`${index + 1}-explanation.json`, report)
    results.push({
      name,
      taskId,
      source,
      sourceSha256: digest(sourceBytes),
      imageId: bundle.image.imageId,
      reusedDetections: true,
      elapsedMs: Math.round(performance.now() - started),
      calls: requests.length,
      mode: report.mode,
      decision: report.result.finalDecision,
      decisionSource: report.result.decisionSource,
      aiGenerationSource: report.result.aiGenerationSource,
      lead: report.result.lead,
      analysis: report.result.analysis,
      reference: item.reference ?? null
    })
  } catch (error) {
    results.push({ name, taskId, source, error: String(error), reference: item.reference ?? null })
  } finally {
    globalThis.fetch = originalFetch
    await save(`${index + 1}-requests.json`, requests)
    await save('results.json', results)
    if (digest(await readFile(source)) !== digest(sourceBytes))
      throw new Error('Source bundle changed during evaluation')
  }
}
console.log(`Saved actual VLM results to ${output}`)
if (results.some((row) => row.error || row.mode !== 'local')) process.exitCode = 1
