import assert from 'node:assert/strict'
import { mkdir, writeFile, open } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = join(project, 'work', 'smoke')
await mkdir(artifacts, { recursive: true })
const runtimeErrors = []
const remoteRequests = []
const checks = []
const testEnv = { ...process.env }
delete testEnv.ELECTRON_RUN_AS_NODE
delete testEnv.ELECTRON_RENDERER_URL
let devServer
if (process.argv.includes('--dev')) {
  const { createServer } = await import('vite')
  const { default: config } = await import('../electron.vite.config.ts')
  devServer = await createServer({ ...config.renderer, configFile: false })
  await devServer.listen()
  testEnv.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173'
}

const packaged = process.argv.includes('--packaged')
const desktop = await electron.launch({
  ...(packaged ? { executablePath: join(project, 'dist', 'win-unpacked', 'SRDP.exe') } : {}),
  args: packaged ? ['--smoke-test'] : [project, '--smoke-test'],
  env: testEnv,
  timeout: 30_000
})

try {
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(12_000)
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url())
  })
  await page.getByRole('heading', { name: '从一张图片开始' }).waitFor()
  assert.equal(await page.getByTestId('analyze-button').isDisabled(), true)
  assert.deepEqual(
    await page.evaluate(() => ({
      hasNode: typeof window.require !== 'undefined',
      methods: Object.keys(window.desktop).sort()
    })),
    {
      hasNode: false,
      methods: ['analyze', 'cancelAnalysis', 'chooseImage', 'clearImage', 'onAnalysisProgress']
    }
  )
  const preferences = await desktop.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return {
      sandbox: preferences.sandbox,
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration
    }
  })
  assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false })
  checks.push('桌面窗口启动、最小桥接接口与进程隔离')
  await page.screenshot({ path: join(artifacts, '01-empty.png') })

  const bitmap = await desktop.evaluate(({ nativeImage }) => {
    const width = 960,
      height = 640
    const pixels = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const horizon = 305 + Math.sin(x / 170) * 28
        const mountain = 345 - Math.sin(x / 180) * 85
        const foreground = y > 470 + Math.sin(x / 100) * 22
        const ridge = y > mountain && y > horizon - 70
        let color = y < horizon ? [150 + y / 12, 119 + y / 10, 76 + y / 13] : [115, 99, 66]
        if (ridge) color = [91 + y / 22, 80 + y / 24, 59 + y / 28]
        if (foreground) color = [54, 64, 45]
        pixels[i] = color[0]
        pixels[i + 1] = color[1]
        pixels[i + 2] = color[2]
        pixels[i + 3] = 255
      }
    }
    const image = nativeImage.createFromBitmap(pixels, { width, height })
    return { png: image.toPNG().toString('base64'), jpeg: image.toJPEG(90).toString('base64') }
  })
  const pngPath = join(artifacts, '演示风景.png')
  const jpgPath = join(artifacts, '第二张图片.jpg')
  const corruptPath = join(artifacts, '损坏图片.png')
  const textPath = join(artifacts, '非图片.txt')
  const largePath = join(artifacts, '超限图片.png')
  await writeFile(pngPath, Buffer.from(bitmap.png, 'base64'))
  await writeFile(jpgPath, Buffer.from(bitmap.jpeg, 'base64'))
  await writeFile(corruptPath, 'this is not an image')
  await writeFile(textPath, 'plain text')
  const largeFile = await open(largePath, 'w')
  try {
    await largeFile.truncate(20 * 1024 * 1024 + 1)
  } finally {
    await largeFile.close()
  }

  async function selectFile(filePath) {
    await desktop.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: path === null,
        filePaths: path ? [path] : []
      })
    }, filePath)
    // The native dialog alone is stubbed. The UI and all remaining app paths are real.
    await page.getByRole('button', { name: /^(选择图片|更换图片)$/ }).click()
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="图片工作区"] button')?.disabled
    )
  }

  await selectFile(null)
  assert.equal(await page.getByTestId('image-preview').count(), 0)
  checks.push('取消文件选择保留空状态')

  await selectFile(pngPath)
  await page.getByTestId('image-name').filter({ hasText: '演示风景.png' }).waitFor()
  assert.equal(await page.getByTestId('analyze-button').isEnabled(), true)
  assert.equal(
    await page
      .getByTestId('image-preview')
      .evaluate((img) => img.complete && img.naturalWidth === 960 && img.naturalHeight === 640),
    true
  )
  assert.equal(await page.getByText('960 × 640', { exact: true }).count(), 1)
  checks.push('原生选择入口、中文文件名、实际 PNG 解码、预览与元信息')

  const stale = await page.evaluate(() => window.desktop.analyze('nonexistent-id', 'stale-test'))
  assert.equal(stale.ok, false)
  assert.match(stale.error, /失效/)
  checks.push('过期或伪造图片 ID 被主进程拒绝')

  await page.getByTestId('analyze-button').click()
  await page.getByText('正在运行模拟流程', { exact: true }).waitFor()
  await page.waitForFunction(
    () => Number(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')) > 0
  )
  assert.equal(await page.getByTestId('analyze-button').isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '更换图片', exact: true }).isDisabled(), true)
  await page.getByTestId('analysis-report').waitFor()
  assert.match(await page.getByTestId('analysis-report').innerText(), /预置的模拟分析描述/)
  assert.match(await page.getByTestId('analysis-report').innerText(), /未运行任何检测或语言模型/)
  checks.push('真实 IPC → 模拟服务 → 加载状态 → 模拟结果展示')
  await page.screenshot({ path: join(artifacts, '02-result.png') })

  await selectFile(null)
  assert.equal(await page.getByTestId('analysis-report').count(), 1)
  checks.push('更换时取消选图，保留已有图片与报告')

  await selectFile(corruptPath)
  await page.getByRole('alert').filter({ hasText: '无法解码' }).waitFor()
  assert.equal(await page.getByTestId('analysis-report').count(), 1)
  await selectFile(textPath)
  await page.getByRole('alert').filter({ hasText: '不支持此文件格式' }).waitFor()
  await selectFile(largePath)
  await page.getByRole('alert').filter({ hasText: '超过 20 MB' }).waitFor()
  checks.push('损坏图片、非图片和超限文件被拒绝，保留此前有效结果')

  await selectFile(jpgPath)
  await page.getByTestId('image-name').filter({ hasText: '第二张图片.jpg' }).waitFor()
  assert.equal(await page.getByTestId('analysis-report').count(), 0)
  assert.equal(await page.getByRole('alert').count(), 0)
  assert.equal(
    await page
      .getByTestId('image-preview')
      .evaluate((img) => img.complete && img.naturalWidth === 960),
    true
  )
  checks.push('JPEG 导入、更换图片清除旧报告与错误')

  const webpData = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 60
    canvas.getContext('2d').fillRect(0, 0, 80, 60)
    return canvas.toDataURL('image/webp')
  })
  assert.match(webpData, /^data:image\/webp;base64,/)
  const webpPath = join(artifacts, '格式测试.webp')
  await writeFile(webpPath, Buffer.from(webpData.split(',')[1], 'base64'))
  await selectFile(webpPath)
  await page.getByTestId('image-name').filter({ hasText: '格式测试.webp' }).waitFor()
  assert.equal(
    await page
      .getByTestId('image-preview')
      .evaluate((img) => img.complete && img.naturalWidth === 80),
    true
  )
  checks.push('WebP 实际解码与预览')

  // Exercise duplicate-run protection in the main process, bypassing disabled UI.
  const duplicate = await page.evaluate(async () => {
    const chosen = await window.desktop.chooseImage()
    if (!chosen.ok || !chosen.data) throw new Error('Expected test image')
    return Promise.all([
      window.desktop.analyze(chosen.data.id, 'duplicate-1'),
      window.desktop.analyze(chosen.data.id, 'duplicate-2')
    ])
  })
  assert.equal(duplicate.filter((result) => result.ok).length, 1)
  assert.equal(duplicate.filter((result) => !result.ok && /正在运行/.test(result.error)).length, 1)
  checks.push('主进程拒绝并发重复分析')

  // Resync the UI selection after the direct bridge check, then verify repeat runs.
  await selectFile(pngPath)
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-report').waitFor()
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-report').waitFor()
  assert.match(await page.getByTestId('analysis-report').innerText(), /演示风景.png/)
  checks.push('重复分析可正常完成')

  await page.getByTestId('analyze-button').click()
  await page
    .getByRole('button', { name: '取消分析', exact: true })
    .evaluate((button) => button.click())
  await page.getByRole('status').filter({ hasText: '模拟分析已取消' }).waitFor()
  assert.equal(await page.getByTestId('analysis-report').count(), 0)
  assert.equal(await page.getByTestId('analyze-button').isEnabled(), true)
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-report').waitFor()
  checks.push('进度事件、取消任务与取消后重新分析')

  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1060, 740))
  await page.waitForFunction(() => window.innerWidth <= 1060)
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true
  )
  await page.screenshot({ path: join(artifacts, '03-minimum-window.png'), fullPage: true })
  checks.push('最小窗口尺寸下无横向溢出')

  await page.getByRole('button', { name: '清空图片' }).click()
  await page.getByTestId('image-preview').waitFor({ state: 'detached' })
  assert.equal(await page.getByTestId('image-preview').count(), 0)
  assert.equal(await page.getByTestId('analysis-report').count(), 0)
  assert.equal(await page.getByTestId('analyze-button').isDisabled(), true)
  const cleared = await page.evaluate(() =>
    window.desktop.analyze('nonexistent-id', 'cleared-test')
  )
  assert.equal(cleared.ok, false)
  assert.equal(cleared.code, 'STALE_IMAGE')
  checks.push('清空图片同时清空分析结果')

  assert.deepEqual(runtimeErrors, [])
  const externalRequests = remoteRequests.filter(
    (url) => !/^http:\/\/127\.0\.0\.1:5173\//.test(url)
  )
  assert.deepEqual(externalRequests, [])
  if (!devServer) assert.deepEqual(remoteRequests, [])
  checks.push(
    devServer ? '无 React 运行时异常，仅访问本机开发服务' : '无 React 运行时异常，无 HTTP 请求'
  )
  const result = {
    passed: true,
    mode: packaged ? 'packaged' : devServer ? 'development' : 'production',
    checks,
    runtimeErrors,
    externalRequests,
    artifacts
  }
  await writeFile(
    join(
      artifacts,
      packaged ? 'result-packaged.json' : devServer ? 'result-dev.json' : 'result.json'
    ),
    JSON.stringify(result, null, 2)
  )
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const page = desktop.windows()[0]
  if (page) await page.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  await desktop.close()
  await devServer?.close()
}
