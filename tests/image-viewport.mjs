import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import sharp from 'sharp'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'work/image-viewport')
await mkdir(output, { recursive: true })
const cases = [
  { name: 'portrait', width: 900, height: 1600 },
  { name: 'panorama', width: 2400, height: 400 },
  { name: 'large', width: 3000, height: 2400 },
  { name: 'small', width: 160, height: 120 },
  { name: 'long', width: 600, height: 6000 }
]
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: [root, '--smoke-test', '--disable-gpu'], env })
const checks = []
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
  for (const [windowWidth, windowHeight] of [
    [1400, 920],
    [1060, 740]
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, [width, height]) =>
        BrowserWindow.getAllWindows()[0].setSize(width, height),
      [windowWidth, windowHeight]
    )
    for (const item of cases) {
      const path = join(output, `${item.name}.png`)
      await sharp({
        create: { width: item.width, height: item.height, channels: 3, background: '#708393' }
      })
        .png()
        .toFile(path)
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, path)
      await page.getByRole('button', { name: '打开图片', exact: true }).click()
      await page.getByTestId('image-preview').waitFor()
      await page.waitForFunction(
        (name) =>
          document.querySelector('[data-testid="image-name"]')?.textContent === `${name}.png`,
        item.name
      )
      await page.getByRole('button', { name: '适应窗口', exact: true }).click()
      await page.waitForFunction(() => {
        const image = document.querySelector('[data-testid="image-preview"]')
        return image?.complete && image.naturalWidth > 0 && image.style.width
      })
      const fit = await page.getByTestId('image-preview').evaluate((image) => {
        const bounds = image.getBoundingClientRect()
        const viewport = image.closest('.image-stage-scroll').getBoundingClientRect()
        return {
          ratio: bounds.width / bounds.height,
          naturalRatio: image.naturalWidth / image.naturalHeight,
          contained:
            bounds.left >= viewport.left - 1 &&
            bounds.right <= viewport.right + 1 &&
            bounds.top >= viewport.top - 1 &&
            bounds.bottom <= viewport.bottom + 1,
          scale: bounds.width / image.naturalWidth,
          overflow: document.documentElement.scrollWidth > innerWidth
        }
      })
      assert.ok(Math.abs(fit.ratio - fit.naturalRatio) < 0.01, `${item.name}: aspect ratio changed`)
      assert.equal(fit.contained, true, `${item.name}: fit image clipped`)
      assert.equal(fit.overflow, false)
      assert.ok(fit.scale <= 2.01, `${item.name}: excessive upscaling`)
      await page.getByRole('button', { name: '100%', exact: true }).click()
      await page.waitForFunction(() => {
        const image = document.querySelector('[data-testid="image-preview"]')
        return image && Math.abs(image.getBoundingClientRect().width - image.naturalWidth) < 1
      })
      const actual = await page.getByTestId('image-preview').evaluate((image) => ({
        width: image.getBoundingClientRect().width,
        natural: image.naturalWidth,
        scrollable:
          image.closest('.image-stage-scroll').scrollHeight >=
          image.getBoundingClientRect().height - 1
      }))
      assert.ok(Math.abs(actual.width - actual.natural) < 1)
      assert.equal(actual.scrollable, true)
      await page.getByRole('button', { name: '适应窗口', exact: true }).click()
      if (
        (item.name === 'portrait' && windowWidth === 1400) ||
        (item.name === 'long' && windowWidth === 1060)
      ) {
        await page.screenshot({ path: join(output, `${item.name}-${windowWidth}.png`) })
      }
      checks.push(
        `${item.name} at ${windowWidth}x${windowHeight}: proportional fit, bounded upscale, preview pixel scale, scroll access`
      )
    }
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(
    await page
      .getByTestId('image-preview')
      .evaluate((image) => getComputedStyle(image).animationName),
    'none'
  )
  checks.push('reduced-motion disables image transitions')
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} finally {
  await app.close()
}
