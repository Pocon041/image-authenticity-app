import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import sharp from 'sharp'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const image = resolve(
  project,
  args.includes('--image')
    ? args[args.indexOf('--image') + 1]
    : 'examples/stage1-materials/sample-003/images/original.jpg'
)
const output = join(project, 'work/rise-smoke')
await mkdir(output, { recursive: true })
const realConfig = JSON.parse(
  (
    await readFile(
      resolve(project, process.env.SRDP_RISE_CONFIG ?? 'config/rise.local.json'),
      'utf8'
    )
  ).replace(/^\uFEFF/, '')
)
const configPath = join(output, 'test-config.local.json')
await writeFile(
  configPath,
  JSON.stringify({ ...realConfig, checkpointPath: 'work/rise-smoke/known-missing.pth' })
)
const env = { ...process.env, SRDP_RISE_CONFIG: configPath }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const desktop = await electron.launch({
  args: [
    project,
    '--smoke-test',
    ...(args.includes('--software-rendering') ? ['--disable-gpu'] : [])
  ],
  env
})
const errors = [],
  http = []
try {
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) http.push(request.url())
  })
  await page.getByRole('heading', { name: '从一张图片开始' }).waitFor()
  await page.getByText('开发与单模型调试', { exact: true }).click()
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, image)
  await page.getByRole('button', { name: '选择图片', exact: true }).click()
  await page.getByTestId('image-name').waitFor()
  await page.getByRole('button', { name: 'RiSE 文档定位', exact: true }).click()
  await page.getByTestId('analyze-button').click()
  await page.getByRole('alert').filter({ hasText: '缺少 RiSE 定位权重' }).waitFor()
  assert.equal(await page.getByTestId('analysis-report').count(), 0)
  await writeFile(configPath, JSON.stringify({ ...realConfig, checkpointSha256: '0'.repeat(64) }))
  await page.getByTestId('analyze-button').click()
  await page.getByRole('alert').filter({ hasText: 'SHA256 mismatch' }).waitFor({ timeout: 90000 })
  assert.equal(await page.getByTestId('analysis-report').count(), 0)
  await writeFile(configPath, JSON.stringify(realConfig))
  await page.getByTestId('analyze-button').click()
  await page.getByText('正在运行 RiSE', { exact: true }).waitFor()
  await page.getByTestId('rise-overlay').waitFor({ timeout: realConfig.timeoutMs })
  const bundle = JSON.parse(await page.getByTestId('rise-bundle').textContent())
  const report = bundle.reports[0]
  assert.equal(report.producer.name, 'RiSE-9-RGB')
  assert.equal(report.mode, 'local')
  assert.equal(report.extensions.strictStateDict, true)
  assert.equal(report.extensions.stateKeys, 868)
  assert.deepEqual(report.extensions.missingKeys, [])
  assert.deepEqual(report.extensions.unexpectedKeys, [])
  assert.equal(report.extensions.checkpointSha256, realConfig.checkpointSha256)
  assert.equal(report.extensions.coverageMin, 1)
  assert.equal(report.extensions.inputResize, false)
  assert.equal(report.extensions.expertMode, 'sequential')
  assert.equal(report.result.decision, 'inconclusive')
  assert.equal(report.result.score.calibrated, false)
  assert.equal(report.result.localization.maskThreshold, 0.5)
  assert.equal(report.result.classification, undefined)
  assert.equal(await page.getByTestId('rita-overlay').count(), 0)
  assert.equal(await page.getByTestId('sica-classification').count(), 0)
  const prefs = await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  )
  assert.equal(prefs.contextIsolation, true)
  assert.equal(prefs.sandbox, true)
  assert.equal(prefs.nodeIntegration, false)
  for (const artifact of report.artifacts) {
    const dimensions = await sharp(
      await readFile(join(project, 'work/rise-runs', report.taskId, artifact.uri))
    ).metadata()
    assert.equal(dimensions.width, artifact.width)
    assert.equal(dimensions.height, artifact.height)
  }
  await page.screenshot({ path: join(output, 'desktop-result.png'), fullPage: true })
  // Cancel after a real model tile has finished, covering inference rather than just Python startup.
  const taskId = randomUUID()
  const cancelled = await page.evaluate(
    async ({ imageId, taskId }) => {
      let stop
      const tile = new Promise((resolve) => {
        stop = window.desktop.onAnalysisProgress((p) => {
          if (p.taskId === taskId && p.label.startsWith('RiSE 分块推理 1/')) resolve()
        })
      })
      const pending = window.desktop.analyze(imageId, taskId, 'rise')
      await Promise.race([
        tile,
        pending.then(() => {
          throw new Error('Task completed before cancellation point')
        })
      ])
      stop()
      const cancellation = await window.desktop.cancelAnalysis(taskId)
      return { cancellation, result: await pending }
    },
    { imageId: bundle.image.imageId, taskId }
  )
  assert.equal(cancelled.cancellation.ok, true)
  assert.equal(cancelled.cancellation.data, true)
  assert.equal(cancelled.result.code, 'CANCELLED')
  await assert.rejects(access(join(project, 'work/rise-runs', taskId, 'bundle.json')))
  assert.deepEqual(errors, [])
  assert.deepEqual(http, [])
  const result = {
    passed: true,
    checks: [
      'missing checkpoint is an explicit error without fallback',
      'incorrect checkpoint hash is rejected',
      'real Electron IPC Python strict 868-state RiSE inference',
      'native full-image coverage and original-coordinate artifacts',
      'uncalibrated localization is separate from image classification',
      'actual inference cancellation leaves no completed bundle',
      'sandbox and context isolation preserved, no renderer exceptions or HTTP'
    ],
    bundlePath: join(project, 'work/rise-runs', report.taskId, 'bundle.json'),
    tileCount: report.extensions.tileCount,
    peakCudaMemoryBytes: report.extensions.peakCudaMemoryBytes
  }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await desktop.close()
}
