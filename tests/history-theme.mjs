// Synthetic images and reports exercise persistence and desktop interaction only.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { _electron as electron } from 'playwright'
import { selectAnalysisMode } from './ui-settings.mjs'
import {
  colorContrast,
  themeTokens,
  themePresets,
  defaultAccent
} from '../src/renderer/src/theme.ts'
import { assertEvidenceBundle, validateExplanationReport } from '../src/shared/protocol.ts'
import { AnalysisHistory } from '../src/main/services/analysis-history.ts'
import { importImage } from '../src/main/image-import.ts'

const root = resolve(import.meta.dirname, '..')
const output = await mkdtemp(join(root, 'work/history-theme-'))
const runtime = join(output, '运行目录')
await mkdir(runtime)
const source = join(output, '竖幅图像-历史记录验证.png')
const png = await sharp({ create: { width: 540, height: 960, channels: 3, background: '#758578' } })
  .png()
  .toBuffer()
await writeFile(source, png)
const legacyPng = await sharp({
  create: { width: 960, height: 540, channels: 3, background: '#8c998a' }
})
  .png()
  .toBuffer()
const mask = await sharp({ create: { width: 960, height: 540, channels: 3, background: 'white' } })
  .greyscale()
  .png()
  .toBuffer()
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const legacyId = 'legacy-history-fixture'
const directory = join(runtime, 'work/analysis-runs', legacyId)
await mkdir(join(directory, 'images'), { recursive: true })
await mkdir(join(directory, 'detectors/rita'), { recursive: true })
await mkdir(join(directory, 'reports'), { recursive: true })
await writeFile(join(directory, 'images/original.png'), legacyPng)
await writeFile(join(directory, 'images/display.png'), legacyPng)
await writeFile(join(directory, 'detectors/rita/mask.png'), mask)
const imageHash = hash(legacyPng)
const image = {
  imageId: `sha256:${imageHash}`,
  sha256: imageHash,
  originalArtifactId: 'legacy-original',
  displayArtifactId: 'legacy-display',
  encodedWidth: 960,
  encodedHeight: 540,
  width: 960,
  height: 540,
  exifOrientation: 1,
  coordinateSpace: 'display_image_pixels',
  displayTransform: 'exif_auto_orient_no_resize'
}
const artifact = (id, type, uri, bytes) => ({
  artifactId: id,
  type,
  uri,
  mediaType: 'image/png',
  sha256: hash(bytes),
  width: 960,
  height: 540,
  coordinateSpace: type === 'original' ? 'encoded_file_pixels' : 'display_image_pixels',
  bboxXYWH: null,
  sourceArtifactId: type === 'original' ? null : 'legacy-original',
  origin: type === 'original' ? 'original' : 'derived'
})
const artifacts = [
  artifact('legacy-original', 'original', 'images/original.png', legacyPng),
  artifact('legacy-display', 'display', 'images/display.png', legacyPng),
  artifact('legacy-mask', 'mask', 'detectors/rita/mask.png', mask)
]
const moduleBase = {
  schemaVersion: '1.0',
  imageId: image.imageId,
  moduleId: 'manipulation',
  mode: 'local',
  status: 'completed',
  producer: { name: 'Synthetic history fixture', version: '1' },
  createdAt: '2026-10-10T08:30:00Z',
  elapsedMs: 100,
  inputReportIds: [],
  evidence: [],
  limitations: [],
  error: null
}
const region = {
  regionId: 'legacy-region',
  bboxXYWH: [20, 20, 200, 100],
  coordinateSpace: 'display_image_pixels',
  maskArtifactId: 'legacy-mask',
  detector: 'rita'
}
const native = {
  ...moduleBase,
  reportId: 'legacy-rita-report',
  taskId: legacyId + '-rita',
  artifacts: [artifacts[2]],
  result: {
    decision: 'inconclusive',
    score: null,
    regions: [region],
    operationHints: [],
    regionCount: 1,
    manipulatedAreaFraction: 0.05
  }
}
const record = {
  backend: 'rita',
  status: 'completed',
  sourceTaskId: native.taskId,
  result: { regionCount: 1, areaFraction: 0.05 }
}
const manipulation = {
  ...moduleBase,
  reportId: 'legacy-workflow-report',
  taskId: legacyId,
  artifacts: [artifacts[2]],
  result: {
    decision: 'inconclusive',
    score: null,
    regions: [region],
    operationHints: [],
    contentType: 'photo',
    executionStatus: 'completed',
    detectors: [record],
    disagreements: []
  },
  extensions: { executionStatus: 'completed', detectorExecutions: [record] }
}
const bundle = {
  schemaVersion: '1.0',
  bundleId: 'legacy-bundle',
  purpose: 'analysis',
  createdAt: moduleBase.createdAt,
  image,
  artifacts,
  reports: [manipulation]
}
assertEvidenceBundle(bundle)
await writeFile(join(directory, 'bundle.json'), JSON.stringify(bundle))
await writeFile(
  join(directory, 'analysis.json'),
  JSON.stringify({ reportType: 'manipulation_summary', image, status: 'completed' })
)
await writeFile(join(directory, 'detectors/rita/report.json'), JSON.stringify(native))
const explanation = {
  ...moduleBase,
  moduleId: 'explanation',
  reportId: 'legacy-explanation',
  taskId: legacyId,
  artifacts: [],
  inputReportIds: [manipulation.reportId],
  result: {
    finalDecision: 'inconclusive',
    confidence: { source: 'unavailable', value: null, calibrated: false },
    analysis: '这是用于历史记录回看的合成说明。定位标记可与原图对照查看。',
    claims: [],
    unresolved: []
  }
}
assert.deepEqual(validateExplanationReport(explanation, bundle.reports), [])
await writeFile(join(directory, 'reports/explanation.json'), JSON.stringify(explanation))

const checks = []
const storageRoot = join(output, 'storage-regression')
const store = new AnalysisHistory(storageRoot)
const imported = await importImage(source)
const storedReport = (index) => ({
  id: `storage-${index}`,
  imageId: imported.asset.id,
  backend: 'mock',
  mode: 'mock',
  createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
  elapsedMs: 1,
  title: 'Synthetic persistence fixture',
  summary: '',
  sections: [],
  disclaimer: 'Synthetic fixture'
})
await Promise.all(
  Array.from({ length: 43 }, (_, index) =>
    store.save(
      { ...imported, asset: { ...imported.asset, name: `记录-${index}.png` } },
      storedReport(index)
    )
  )
)
const firstPage = await store.list('', 0)
const secondPage = await store.list('', 40)
assert.equal(firstPage.total, 43)
assert.equal(firstPage.entries.length, 40)
assert.equal(secondPage.entries.length, 3)
assert.equal(
  new Set([...firstPage.entries, ...secondPage.entries].map((entry) => entry.id)).size,
  43
)
assert.equal((await store.list('记录-42', 0)).entries[0].id, 'storage-42')
await assert.rejects(store.save(imported, storedReport(0)))
assert.equal((await store.open('storage-0')).image.asset.name, '记录-0.png')
assert.equal(
  (await readdir(join(storageRoot, 'work/desktop-history'))).some((name) => name.endsWith('.tmp')),
  false
)
const legacy = await new AnalysisHistory(runtime).open(legacyId)
const restored = { ...legacy.report }
delete restored.explanation
await store.save(legacy.image, restored)
await store.saveExplanation(explanation)
assert.equal(
  (await store.open(legacyId)).report.explanation.result.analysis,
  explanation.result.analysis
)
await assert.rejects(store.saveExplanation({ ...explanation, imageId: imported.asset.id }))
await writeFile(join(storageRoot, 'work/desktop-history/storage-1/entry.json'), 'invalid JSON')
assert.equal((await store.list('', 0)).skipped, 1)
await writeFile(
  join(storageRoot, 'work/desktop-history/storage-2/report.json'),
  JSON.stringify({ ...storedReport(2), sections: [null] })
)
await assert.rejects(store.open('storage-2'))
checks.push(
  'Atomic snapshots, 40-item pagination, search, duplicate-write protection, explanation persistence and damaged metadata handling'
)
for (const color of [
  ...themePresets.map((preset) => preset.color),
  '#ffffff',
  '#000000',
  '#ffff00',
  '#00ffff',
  '#ff00ff',
  '#ff0000',
  '#00ff00'
]) {
  for (const mode of ['light', 'dark']) {
    const tokens = themeTokens(color, mode)
    for (const surface of [
      '--surface-base',
      '--surface-panel',
      '--surface-canvas',
      '--surface-control',
      '--surface-selected',
      '--surface-hover'
    ]) {
      for (const ink of ['--ink-primary', '--ink-secondary', '--ink-muted', '--accent'])
        assert.ok(
          colorContrast(tokens[ink], tokens[surface]) >= 4.5,
          `${color} ${mode} ${ink} ${surface}`
        )
      assert.ok(
        colorContrast(tokens['--focus-ring'], tokens[surface]) >= 3,
        `${color} ${mode} focus`
      )
    }
    assert.ok(colorContrast(tokens['--action-fill'], tokens['--action-ink']) >= 4.5, color)
  }
}
checks.push(
  'Preset and extreme custom colors retain readable actions, selected labels and focus rings'
)
const env = { ...process.env, SRDP_RUNTIME_ROOT: runtime }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const profile = join(output, 'profile')
const errors = []
let desktop
const executableIndex = process.argv.indexOf('--executable')
const executablePath = executableIndex >= 0 ? resolve(process.argv[executableIndex + 1]) : undefined
const settingsGeometry = []
async function verifySettingsGeometry(page, size) {
  const dialog = page.getByRole('dialog', { name: '设置', exact: true })
  await dialog.evaluate((element) =>
    element.getAnimations().forEach((animation) => animation.finish())
  )
  const initial = await dialog.boundingBox()
  for (const name of ['运行环境', '开发与单模型调试', '外观']) {
    await page.getByRole('tab', { name, exact: true }).click()
    const current = await dialog.boundingBox()
    for (const key of ['x', 'y', 'width', 'height'])
      assert.ok(Math.abs(current[key] - initial[key]) < 0.5, `${size} ${name} ${key}`)
    settingsGeometry.push({ size, tab: name, ...current })
  }
  // Stress only the scroll container, then remove the temporary layout fixture.
  const overflow = await page
    .getByRole('tabpanel', { name: '外观', exact: true })
    .evaluate((panel) => {
      const fixture = document.createElement('div')
      fixture.style.height = '1200px'
      panel.appendChild(fixture)
      panel.scrollTop = panel.scrollHeight
      const scrolled = panel.scrollTop > 0
      const box = panel.closest('dialog').getBoundingClientRect()
      const result = { scrolled, x: box.x, y: box.y, width: box.width, height: box.height }
      fixture.remove()
      panel.scrollTop = 0
      return result
    })
  assert.equal(overflow.scrolled, true)
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(overflow[key] - initial[key]) < 0.5)
}
async function launch() {
  desktop = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(executablePath ? [] : [root]),
      '--smoke-test',
      '--disable-gpu',
      `--user-data-dir=${profile}`
    ],
    env
  })
  const page = await desktop.firstWindow()
  if (executablePath)
    await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
  await desktop.evaluate(() => {
    globalThis.__historyExplanations = 0
  })
  return page
}
try {
  let page = await launch()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByRole('radio', { name: '浅色', exact: true }).check()
  await verifySettingsGeometry(page, '1400x920')
  const initialCanvas = await page
    .locator('.image-panel')
    .evaluate((node) => getComputedStyle(node).backgroundColor)
  await page.getByRole('radio', { name: '雾蓝', exact: true }).check()
  assert.equal(
    await page.evaluate(() => localStorage.getItem('authenticity.accent-color')),
    '#4d6f9a'
  )
  assert.notEqual(
    await page.locator('.image-panel').evaluate((node) => getComputedStyle(node).backgroundColor),
    initialCanvas
  )
  await page.getByLabel('主题色色值', { exact: true }).fill('#ffffff')
  await page.getByLabel('主题色色值', { exact: true }).press('Enter')
  assert.notEqual(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--action-fill').trim()
    ),
    '#ffffff'
  )
  await page.getByLabel('主题色色值', { exact: true }).fill('abc')
  await page.getByLabel('主题色色值', { exact: true }).press('Enter')
  assert.equal(await page.getByLabel('主题色色值', { exact: true }).inputValue(), '#aabbcc')
  await page.getByLabel('主题色色值', { exact: true }).fill('#nope')
  await page.getByLabel('主题色色值', { exact: true }).press('Enter')
  await page.getByRole('alert').waitFor()
  await page.getByRole('radio', { name: '雾蓝', exact: true }).check()
  await page.screenshot({ animations: 'disabled', path: join(output, 'appearance.png') })
  await page.keyboard.press('Escape')
  checks.push(
    'Appearance presets and custom hex recolor backgrounds and controls together and reject invalid values'
  )
  await page.screenshot({ animations: 'disabled', path: join(output, 'workspace-light.png') })

  await selectAnalysisMode(page, '模拟流程')
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, source)
  await page.getByRole('button', { name: '打开图片', exact: true }).click()
  await page.getByTestId('image-name').waitFor()
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-report').waitFor()
  let records = await page.evaluate(() => window.desktop.listHistory('', 0))
  assert.equal(records.ok, true)
  assert.equal(records.data.total, 2)
  const snapshot = records.data.entries.find((entry) => entry.backend === 'mock')
  assert.equal(snapshot.name, '竖幅图像-历史记录验证.png')
  await rename(source, join(output, 'original-moved.png'))
  await page.getByRole('button', { name: '清空图片', exact: true }).click()
  await page.keyboard.press('Control+h')
  const history = page.getByRole('dialog', { name: '历史记录', exact: true })
  await history.waitFor()
  await history.getByRole('button', { name: `查看 ${snapshot.name}`, exact: true }).waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.history-thumbnail img')].every(
      (image) => image.naturalWidth > 0
    )
  )
  await page.screenshot({ animations: 'disabled', path: join(output, 'history.png') })
  await history.getByRole('button', { name: `查看 ${snapshot.name}`, exact: true }).click()
  await history.waitFor({ state: 'hidden' })
  await page.getByTestId('analysis-report').waitFor()
  assert.equal(await page.getByTestId('image-name').textContent(), snapshot.name)
  assert.ok(await page.locator('time[title]').count())
  checks.push(
    'Normal analysis saves its original and report, and history reopens them after the source file moves'
  )

  await page.getByRole('button', { name: '历史记录', exact: true }).click()
  await history.getByLabel('搜索历史记录').fill('不存在的图像')
  await history.getByText('未找到匹配的记录', { exact: true }).waitFor()
  await history.getByLabel('搜索历史记录').fill('')
  const legacyName = `图像-${imageHash.slice(0, 8)}.png`
  await history.getByRole('button', { name: `查看 ${legacyName}`, exact: true }).click()
  await history.waitFor({ state: 'hidden' })
  await page
    .getByText('这是用于历史记录回看的合成说明。定位标记可与原图对照查看。', { exact: true })
    .waitFor()
  await page.getByRole('button', { name: '查看原图', exact: true }).click()
  await page.getByRole('button', { name: '查看定位', exact: true }).click()
  await page.screenshot({ animations: 'disabled', path: join(output, 'restored-report.png') })
  checks.push(
    'Legacy report, verified original, mask-based localization and saved explanation reopen through the standard workbench'
  )

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.getByRole('radio', { name: '深色', exact: true }).check()
  await page.waitForFunction(() => document.documentElement.dataset.appearance === 'dark')
  await page.screenshot({ animations: 'disabled', path: join(output, 'appearance-dark.png') })
  await page.keyboard.press('Escape')
  await page.screenshot({ animations: 'disabled', path: join(output, 'workbench-dark.png') })
  const darkChrome = await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBackgroundColor()
  )
  assert.equal(darkChrome.toLowerCase(), themeTokens('#4d6f9a', 'dark')['--surface-base'])
  const navigation = await page.locator('.app-navigation').boundingBox()
  const fileActions = await page.getByRole('group', { name: '图片操作' }).boundingBox()
  assert.ok(navigation.width <= 72 && fileActions.x > navigation.x + navigation.width)
  assert.equal(await page.getByRole('button', { name: '更换图片', exact: true }).count(), 1)
  assert.equal(Math.round((await page.locator('.desktop-titlebar').boundingBox()).height), 42)
  assert.ok(
    await page
      .getByRole('button', { name: '设置', exact: true })
      .evaluate((node) => node.getBoundingClientRect().top > innerHeight * 0.7)
  )
  assert.equal(
    (
      await page.evaluate(() =>
        window.desktop.setWindowTheme({ mode: 'invalid', background: '#fff', foreground: '#fff' })
      )
    ).ok,
    false
  )
  const textContrast = await page.evaluate(() => {
    const parse = (value) => (value.match(/[\d.]+/g) ?? []).map(Number)
    function composite(foreground, background) {
      const alpha = foreground[3] ?? 1
      return foreground
        .slice(0, 3)
        .map((value, index) => value * alpha + background[index] * (1 - alpha))
    }
    function luminance(channels) {
      return channels.reduce((sum, channel, index) => {
        const value = channel / 255
        return (
          sum +
          (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][index]
        )
      }, 0)
    }
    const results = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const element = node.parentElement
      if (
        !node.textContent.trim() ||
        !element ||
        !element.checkVisibility() ||
        !element.getBoundingClientRect().width ||
        element.closest('button:disabled, option, script, style, .sr-only')
      )
        continue
      const chain = []
      for (let current = element; current; current = current.parentElement) chain.unshift(current)
      let background = [255, 255, 255]
      for (const current of chain)
        background = composite(parse(getComputedStyle(current).backgroundColor), background)
      const foreground = composite(parse(getComputedStyle(element).color), background)
      const a = luminance(foreground),
        b = luminance(background)
      results.push({
        text: node.textContent.trim().slice(0, 45),
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      })
    }
    return results
  })
  await writeFile(join(output, 'dark-text-contrast.json'), JSON.stringify(textContrast, null, 2))
  assert.deepEqual(
    textContrast.filter((item) => item.ratio < 4.5),
    []
  )
  checks.push(
    'Dark backgrounds, readable report typography, native window chrome and contextual file actions are synchronized'
  )

  await rm(join(directory, 'reports/explanation.json'))
  await desktop.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('srdp:analysis:explain')
    ipcMain.handle('srdp:analysis:explain', () => {
      globalThis.__historyExplanations++
      return { ok: false, code: 'INTERNAL', error: 'Unexpected model call' }
    })
  })
  await page.getByRole('button', { name: '历史记录', exact: true }).click()
  await history.getByRole('button', { name: `查看 ${legacyName}`, exact: true }).click()
  await page.getByText('此记录未保存综合说明。', { exact: true }).waitFor()
  await page.waitForTimeout(300)
  assert.equal(await desktop.evaluate(() => globalThis.__historyExplanations), 0)
  assert.equal(await page.getByTestId('workflow-technical-details').getAttribute('open'), '')
  checks.push(
    'Opening a record without explanation preserves the saved result and performs no new model inference'
  )

  const forged = await page.evaluate(() => window.desktop.openHistory('../outside'))
  assert.equal(forged.ok, false)
  assert.equal((await page.evaluate(() => window.desktop.listHistory('', -1))).ok, false)
  await writeFile(
    join(runtime, 'work/desktop-history', snapshot.id, 'original.png'),
    Buffer.from('damaged image')
  )
  assert.equal((await page.evaluate((id) => window.desktop.openHistory(id), snapshot.id)).ok, false)
  checks.push(
    'Invalid IDs, invalid pagination and damaged originals fail without replacing the active workbench'
  )

  await desktop.close()
  page = await launch()
  assert.equal(
    await page.evaluate(() => localStorage.getItem('authenticity.accent-color')),
    '#4d6f9a'
  )
  assert.equal(
    await page.evaluate(() => document.documentElement.style.getPropertyValue('--accent')),
    themeTokens('#4d6f9a', 'dark')['--accent']
  )
  await page.screenshot({ animations: 'disabled', path: join(output, 'workspace-dark.png') })
  await page.getByRole('button', { name: '历史记录', exact: true }).click()
  await page
    .getByRole('dialog', { name: '历史记录', exact: true })
    .getByRole('button', { name: `查看 ${legacyName}`, exact: true })
    .waitFor()
  await page.keyboard.press('Escape')
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1060, 740))
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('tab', { name: '外观', exact: true }).click()
  await page.screenshot({ animations: 'disabled', path: join(output, 'appearance-compact.png') })
  await verifySettingsGeometry(page, '1060x740')
  await writeFile(join(output, 'settings-geometry.json'), JSON.stringify(settingsGeometry, null, 2))
  checks.push(
    'Settings frame retains its size and position across all categories and scrolls long content internally at both desktop sizes'
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.getByRole('button', { name: '恢复默认', exact: true }).click()
  const appearance = await page.evaluate(() => ({
    accent: document.documentElement.style.getPropertyValue('--accent'),
    mode: document.documentElement.dataset.appearance
  }))
  assert.equal(appearance.accent, themeTokens(defaultAccent, appearance.mode)['--accent'])
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.appearance === 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.appearance === 'light')
  checks.push(
    'System appearance follows color-scheme changes while preserving the selected full-surface palette'
  )
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '历史记录', exact: true }).click()
  await page.screenshot({ animations: 'disabled', path: join(output, 'history-compact.png') })
  checks.push(
    'Theme and history survive a real restart, reset correctly, and fit the minimum desktop window'
  )
  assert.deepEqual(errors, [])
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, checks }, null, 2))
  console.log(JSON.stringify({ passed: true, checks, output }, null, 2))
} finally {
  await desktop?.close()
}
