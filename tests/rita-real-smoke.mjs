import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const image = resolve(
  project,
  args.includes('--image')
    ? args[args.indexOf('--image') + 1]
    : 'examples/stage1-materials/sample-002/images/original.jpg'
)
const configPath = process.env.SRDP_RITA_CONFIG ?? join(project, 'config/rita.local.json')
const config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''))
const checkpointHash = createHash('sha256')
  .update(await readFile(resolve(project, config.checkpointPath)))
  .digest('hex')
await access(image)
const output = join(project, 'work/rita-real-smoke')
await mkdir(output, { recursive: true })
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const desktop = await electron.launch({ args: [project, '--smoke-test'], env })
const runtimeErrors = [],
  remoteRequests = []
try {
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(45000)
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url())
  })
  await page.getByRole('heading', { name: '从一张图片开始' }).waitFor()
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, image)
  await page.getByRole('button', { name: '选择图片', exact: true }).click()
  await page.getByTestId('image-name').waitFor()
  await page.getByRole('button', { name: 'RITA 本地定位', exact: true }).click()
  await page.evaluate(() => {
    window.__ritaProgress = []
    window.__stopRitaProgress = window.desktop.onAnalysisProgress((progress) =>
      window.__ritaProgress.push(progress)
    )
  })
  await page.getByTestId('analyze-button').click()
  await page.getByText('正在运行 RITA', { exact: true }).waitFor()
  await page.getByTestId('rita-overlay').waitFor({ timeout: 180000 })
  await page.getByTestId('rita-overlay').evaluate(async (img) => {
    await img.decode()
  })
  assert.equal(await page.getByRole('alert').count(), 0)
  const bundle = JSON.parse(await page.getByTestId('rita-bundle').textContent())
  assert.equal(bundle.purpose, 'analysis')
  assert.equal(bundle.reports.length, 1)
  const report = bundle.reports[0]
  assert.equal(report.mode, 'local')
  assert.equal(report.moduleId, 'manipulation')
  assert.equal(report.extensions.strictStateDict, true)
  assert.equal(report.extensions.checkpointSha256, checkpointHash)
  if (config.decisionThreshold === null) assert.equal(report.result.decision, 'inconclusive')
  assert.equal(report.result.score?.calibrated ?? false, false)
  assert.ok(bundle.artifacts.some((asset) => asset.type === 'mask'))
  assert.ok(report.evidence.every((entry) => entry.origin !== 'mock'))
  const progress = await page.evaluate(() => {
    window.__stopRitaProgress()
    return window.__ritaProgress
  })
  assert.ok(progress.some((event) => event.percent === 25))
  assert.ok(progress.some((event) => event.percent === 100))
  const overlaySize = await page
    .getByTestId('rita-overlay')
    .evaluate((img) => [img.naturalWidth, img.naturalHeight])
  assert.deepEqual(overlaySize, [bundle.image.width, bundle.image.height])
  await page.screenshot({
    path: join(output, 'desktop-result.png'),
    fullPage: true,
    timeout: 20000
  })
  await writeFile(join(output, 'bundle.json'), JSON.stringify(bundle, null, 2))

  // Exercise the actual Python cancellation path before a second inference can finish.
  const cancelTask = randomUUID()
  const cancelled = await page.evaluate(
    async ({ imageId, taskId }) => {
      const pending = window.desktop.analyze(imageId, taskId, 'rita')
      await new Promise((resolve) => setTimeout(resolve, 300))
      const cancellation = await window.desktop.cancelAnalysis(taskId)
      return { cancellation, result: await pending }
    },
    { imageId: bundle.image.imageId, taskId: cancelTask }
  )
  assert.equal(cancelled.cancellation.ok, true)
  assert.equal(cancelled.cancellation.data, true)
  assert.equal(cancelled.result.ok, false)
  assert.equal(cancelled.result.code, 'CANCELLED')
  await assert.rejects(access(join(project, 'work/rita-runs', cancelTask, 'bundle.json')))
  assert.deepEqual(runtimeErrors, [])
  assert.deepEqual(remoteRequests, [])
  const result = {
    passed: true,
    checkpointSha256: checkpointHash,
    checks: [
      'real file import → IPC → Python → strict official checkpoint',
      'real mask overlay and v1 report shown in Electron',
      'progress events received',
      'unvalidated decision remains inconclusive',
      'real subprocess cancellation produces no completed bundle',
      'no renderer exceptions or HTTP requests'
    ],
    imageId: bundle.image.imageId,
    inferenceMs: report.extensions.inferenceMs,
    runtimeErrors,
    remoteRequests
  }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await desktop.close()
}
