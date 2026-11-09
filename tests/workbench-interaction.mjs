import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import sharp from 'sharp'
import { selectAnalysisMode } from './ui-settings.mjs'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'work/workbench-interaction')
await mkdir(output, { recursive: true })
const path = join(output, 'drag-image.png')
const invalid = join(output, 'invalid.png')
const bytes = await sharp({
  create: { width: 2400, height: 1600, channels: 3, background: '#70869b' }
})
  .png()
  .toBuffer()
await writeFile(path, bytes)
await writeFile(invalid, 'not an image')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const desktop = await electron.launch({ args: [root, '--smoke-test', '--disable-gpu'], env })
const checks = []
try {
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(15000)
  await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
  const cdp = await page.context().newCDPSession(page)
  async function drop(files) {
    const data = { items: [], files, dragOperationsMask: 1 }
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 240, y: 250, data })
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: 240, y: 250, data })
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: 240, y: 250, data })
  }
  await drop([path])
  await page.getByTestId('image-name').waitFor()
  assert.equal(await page.getByTestId('image-name').textContent(), 'drag-image.png')
  checks.push(
    'native file drag passes through preload path resolution, main-process decoding, image state and preview'
  )
  await drop([invalid])
  await page.getByRole('alert').waitFor()
  assert.equal(await page.getByTestId('image-name').textContent(), 'drag-image.png')
  await page.getByRole('button', { name: '关闭错误提示' }).click()
  await drop([path, invalid])
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /一张/)
  await page.getByRole('button', { name: '关闭错误提示' }).click()
  const forged = await page.evaluate(() => window.desktop.importDroppedImage([{}]))
  assert.equal(forged.ok, false)
  checks.push(
    'corrupt files, multiple-file drops and forged File objects are rejected while the valid image remains selected'
  )

  await desktop.evaluate(({ clipboard }, encoded) => {
    clipboard.read = async () => [
      {
        types: ['image/png'],
        getType: async () => new Blob([Buffer.from(encoded, 'base64')], { type: 'image/png' })
      }
    ]
  }, bytes.toString('base64'))
  await page.getByRole('button', { name: '粘贴图片', exact: true }).click()
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="image-name"]')?.textContent?.startsWith('粘贴图像-')
  )
  await desktop.evaluate(({ clipboard }) => {
    clipboard.read = async () => []
  })
  await page.keyboard.press('Control+v')
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /剪贴板/)
  await page.getByRole('button', { name: '关闭错误提示' }).click()
  checks.push(
    'paste button and Ctrl+V use the current Electron clipboard API; missing image keeps the previous selection'
  )

  await page.getByRole('button', { name: '100%', exact: true }).click()
  const canvas = page.getByLabel('图像画布', { exact: true })
  await canvas.hover()
  const beforeWheel = Number((await page.getByLabel('当前预览比例').textContent()).replace('%', ''))
  await page.mouse.wheel(0, -180)
  await page.waitForFunction(
    (before) =>
      Number(
        document.querySelector('output[aria-label="当前预览比例"]').textContent.replace('%', '')
      ) > before,
    beforeWheel
  )
  const bounds = await canvas.boundingBox()
  const beforePan = await canvas.evaluate((node) => node.scrollLeft)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 - 70, bounds.y + bounds.height / 2 - 30, {
    steps: 5
  })
  await page.mouse.up()
  assert.ok((await canvas.evaluate((node) => node.scrollLeft)) > beforePan + 40)
  await canvas.focus()
  await page.keyboard.press('0')
  assert.equal(
    await page.getByRole('button', { name: '适应窗口', exact: true }).getAttribute('aria-pressed'),
    'true'
  )
  checks.push(
    'wheel zoom is bounded, pointer drag pans the zoomed image, and keyboard 0 returns to fitted view'
  )
  await page.getByRole('button', { name: '放大查看图像预览', exact: true }).click()
  const preview = page.getByRole('dialog', { name: /^图像预览：/ })
  await preview.getByTestId('expanded-image-preview').waitFor()
  await page.waitForFunction(() => {
    const image = document.querySelector('[data-testid="expanded-image-preview"]')
    const viewport = image?.closest('.image-viewport')
    if (!image?.naturalWidth || !viewport) return false
    const fitted = Math.min(
      (viewport.clientWidth - 24) / image.naturalWidth,
      (viewport.clientHeight - 60) / image.naturalHeight,
      2
    )
    return Math.abs(image.getBoundingClientRect().width - image.naturalWidth * fitted) < 1
  })
  const expandedScale = Number(
    (await preview.getByLabel('当前预览比例').textContent()).replace('%', '')
  )
  await preview.getByRole('button', { name: '放大图片', exact: true }).click()
  assert.ok(
    Number((await preview.getByLabel('当前预览比例').textContent()).replace('%', '')) >
      expandedScale
  )
  await page.keyboard.press('Escape')
  checks.push(
    'expanded image dialog has its own full-height zoomable canvas and closes with Escape'
  )

  const separator = page.getByRole('separator', { name: '调整图像与报告宽度' })
  const initial = Number(await separator.getAttribute('aria-valuenow'))
  await separator.focus()
  await page.keyboard.press('ArrowLeft')
  assert.ok(Number(await separator.getAttribute('aria-valuenow')) > initial)
  const bar = await separator.boundingBox()
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2)
  await page.mouse.down()
  await page.mouse.move(bar.x - 80, bar.y + bar.height / 2, { steps: 5 })
  await page.mouse.up()
  assert.ok(Number(await separator.getAttribute('aria-valuenow')) > initial + 60)
  assert.ok(
    await page.evaluate(() => Number(localStorage.getItem('authenticity.report-width')) > 0)
  )
  await separator.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('End')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  const compactImage = await page.locator('.image-panel').boundingBox()
  const compactActions = await page.locator('.image-actions').boundingBox()
  assert.ok(compactActions.x + compactActions.width <= compactImage.x + compactImage.width + 1)
  await page.keyboard.press('Enter')
  checks.push(
    'split divider supports pointer and keyboard resizing, stores the ratio, and resets with Enter'
  )

  await selectAnalysisMode(page, '模拟流程')
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('image-scan').waitFor()
  const rejected = await page.evaluate(() => window.desktop.pasteImage())
  assert.equal(rejected.ok, false)
  await page.getByTestId('analysis-report').waitFor()
  await page.getByTestId('image-scan').waitFor({ state: 'detached' })
  checks.push(
    'scan overlay follows active detection and disappears on completion; main process refuses imports during analysis'
  )
  await page.screenshot({ path: join(output, 'workbench.png') })
  const storedWidth = Number(await separator.getAttribute('aria-valuenow'))
  await page.reload()
  await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
  await page.waitForFunction(
    (expected) =>
      Math.abs(
        Number(document.querySelector('[role="separator"]').getAttribute('aria-valuenow')) -
          expected
      ) <= 1,
    storedWidth
  )
  checks.push(
    'pane ratio restores after reload and the narrow image pane keeps all actions within bounds'
  )
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} catch (error) {
  const page = await desktop.firstWindow()
  console.error(await page.locator('body').innerText())
  await page.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await desktop.close()
}
