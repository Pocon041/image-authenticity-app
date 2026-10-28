import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(project, 'work/rita-smoke')
await mkdir(output, { recursive: true })
const configPath = join(output, 'missing-checkpoint.local.json')
await writeFile(
  configPath,
  JSON.stringify({
    pythonPath: 'python',
    upstreamPath: '.tools/rita-upstream/rita.py',
    checkpointPath: 'work/rita-smoke/known-missing-checkpoint.pth',
    checkpointSha256: null,
    device: 'cpu',
    maxSteps: 10,
    decisionThreshold: null,
    timeoutMs: 30000
  })
)
const env = { ...process.env, SRDP_RITA_CONFIG: configPath }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const desktop = await electron.launch({
  args: [
    project,
    '--smoke-test',
    ...(process.argv.includes('--software-rendering') ? ['--disable-gpu'] : [])
  ],
  env
})
try {
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(12000)
  await page.getByRole('heading', { name: '从一张图片开始' }).waitFor()
  await page.getByText('开发与单模型调试', { exact: true }).click()
  const path = join(output, '输入测试.png')
  const png = await desktop.evaluate(({ nativeImage }) =>
    nativeImage
      .createFromBitmap(Buffer.alloc(8 * 6 * 4, 255), { width: 8, height: 6 })
      .toPNG()
      .toString('base64')
  )
  await writeFile(path, Buffer.from(png, 'base64'))
  await desktop.evaluate(({ dialog }, imagePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] })
  }, path)
  await page.getByRole('button', { name: '选择图片', exact: true }).click()
  await page.getByTestId('image-name').waitFor()
  const repeated = await page.evaluate(async () => {
    const first = await window.desktop.chooseImage()
    const second = await window.desktop.chooseImage()
    return { first: first.ok ? first.data.id : '', second: second.ok ? second.data.id : '' }
  })
  assert.equal(repeated.first, repeated.second)
  assert.match(repeated.first, /^sha256:[a-f0-9]{64}$/)
  await page.getByRole('button', { name: 'RITA 本地定位', exact: true }).click()
  await page.getByTestId('analyze-button').click()
  await page.getByRole('alert').filter({ hasText: '缺少官方 RITA 权重' }).waitFor()
  assert.equal(await page.getByTestId('analysis-report').count(), 0)
  assert.equal(await page.getByTestId('rita-overlay').count(), 0)
  const response = await page.evaluate(
    (imageId) => window.desktop.analyze(imageId, 'missing-model-check', 'rita'),
    repeated.first
  )
  assert.equal(response.ok, false)
  assert.equal(response.code, 'MODEL_NOT_READY')
  const invalid = await page.evaluate(
    (imageId) => window.desktop.analyze(imageId, '../invalid-task', 'rita'),
    repeated.first
  )
  assert.equal(invalid.code, 'INVALID_REQUEST')
  await page.getByRole('button', { name: '模拟流程', exact: true }).click()
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-report').waitFor()
  assert.match(await page.getByTestId('analysis-report').innerText(), /模拟分析已完成/)
  const result = {
    passed: true,
    checks: [
      'SHA256 identity survives repeated import',
      'RITA mode uses real IPC',
      'missing weights return MODEL_NOT_READY with no fabricated report',
      'unsafe task ID is rejected',
      'mock mode remains explicitly separate'
    ]
  }
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await desktop.close()
}
