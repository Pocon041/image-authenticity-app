import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
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
    : 'examples/stage1-materials/sample-003/images/original.jpg'
)
const output = join(project, 'work/sica-smoke')
await mkdir(output, { recursive: true })
await access(image)
const realConfig = JSON.parse(
  (
    await readFile(
      resolve(project, process.env.SRDP_SICA_CONFIG ?? 'config/sica.local.json'),
      'utf8'
    )
  ).replace(/^\uFEFF/, '')
)
const configPath = join(output, 'test-config.local.json')
await writeFile(
  configPath,
  JSON.stringify({ ...realConfig, checkpointPath: 'work/sica-smoke/known-missing.pth' })
)
const env = { ...process.env, SRDP_SICA_CONFIG: configPath }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const desktop = await electron.launch({ args: [project, '--smoke-test'], env })
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
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, image)
  await page.getByRole('button', { name: '选择图片', exact: true }).click()
  await page.getByTestId('image-name').waitFor()
  await page.getByRole('button', { name: 'SICA 图像二分类', exact: true }).click()
  await page.getByTestId('analyze-button').click()
  await page.getByRole('alert').filter({ hasText: '缺少 SICA 权重' }).waitFor()
  assert.equal(await page.getByTestId('analysis-report').count(), 0)
  await writeFile(configPath, JSON.stringify(realConfig))
  await page.getByTestId('analyze-button').click()
  await page.getByText('正在运行 SICA', { exact: true }).waitFor()
  await page.getByTestId('sica-classification').waitFor({ timeout: 180000 })
  const bundle = JSON.parse(await page.getByTestId('sica-bundle').textContent())
  const report = bundle.reports[0]
  assert.equal(report.mode, 'local')
  assert.equal(report.producer.name, 'SICA-general-classification')
  assert.equal(report.extensions.strictStateDict, true)
  assert.equal(report.extensions.stateKeyCount, 568)
  assert.equal(report.extensions.loraModuleCount, 48)
  assert.equal(report.extensions.checkpointSha256, realConfig.checkpointSha256)
  assert.deepEqual(report.extensions.missingKeys, [])
  assert.deepEqual(report.extensions.unexpectedKeys, [])
  assert.equal(report.result.classification.threshold, realConfig.threshold)
  assert.equal(report.result.score.positiveClass, 'fake')
  assert.equal(report.result.score.calibrated, false)
  assert.equal(report.result.localization.status, 'not_run')
  assert.deepEqual(report.result.regions, [])
  assert.equal(await page.getByTestId('rita-overlay').count(), 0)
  assert.equal(await page.getByRole('alert').count(), 0)
  const taskId = randomUUID()
  const cancelled = await page.evaluate(
    async ({ imageId, taskId }) => {
      const pending = window.desktop.analyze(imageId, taskId, 'sica')
      await new Promise((resolve) => setTimeout(resolve, 500))
      const cancellation = await window.desktop.cancelAnalysis(taskId)
      return { cancellation, result: await pending }
    },
    { imageId: bundle.image.imageId, taskId }
  )
  assert.equal(cancelled.cancellation.ok, true)
  assert.equal(cancelled.cancellation.data, true)
  assert.equal(cancelled.result.ok, false)
  assert.equal(cancelled.result.code, 'CANCELLED')
  await assert.rejects(access(join(project, 'work/sica-runs', taskId, 'bundle.json')))
  await page.screenshot({ path: join(output, 'desktop-result.png'), fullPage: true })
  await writeFile(join(output, 'bundle.json'), JSON.stringify(bundle, null, 2))
  assert.deepEqual(errors, [])
  assert.deepEqual(http, [])
  const result = {
    passed: true,
    checks: [
      'missing checkpoint is an explicit error with no mock fallback',
      'real Electron → IPC → Python → 568-key strict checkpoint',
      '48 LoRA modules and classification head loaded',
      'score and result rendered without fabricated localization',
      'real subprocess cancellation',
      'no renderer exception or HTTP request'
    ],
    score: report.result.score.value,
    decision: report.result.classification.predictedClass,
    checkpointSha256: report.extensions.checkpointSha256
  }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await desktop.close()
}
