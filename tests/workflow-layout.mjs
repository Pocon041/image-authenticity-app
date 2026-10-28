// Display regression only: replay a previously verified real workflow snapshot.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
const project = resolve(import.meta.dirname, '..')
const run = JSON.parse(await readFile(join(project, 'work/workflow-smoke/result.json'), 'utf8'))
const bundlePath = run.documentBundle,
  directory = dirname(bundlePath)
const bundle = JSON.parse(await readFile(bundlePath, 'utf8'))
const source = bundle.reports[0],
  summary = JSON.parse(await readFile(join(directory, 'analysis.json'), 'utf8'))
const detectors = []
for (const item of source.result.detectors) {
  if (item.status !== 'completed') {
    detectors.push({ backend: item.backend, status: item.status, elapsedMs: 0 })
    continue
  }
  const sourceDirectory = join(project, `work/${item.backend}-runs`, item.sourceTaskId)
  const nativeBundle = JSON.parse(await readFile(join(sourceDirectory, 'bundle.json'), 'utf8'))
  const common = {
    backend: item.backend,
    status: item.status,
    elapsedMs: nativeBundle.reports[0].elapsedMs
  }
  if (item.backend === 'sica')
    detectors.push({
      ...common,
      classification: {
        decision: item.result.classification.predictedClass,
        score: item.result.score.value,
        threshold: item.result.classification.threshold,
        checkpointVariant: 'full',
        bundlePath: join(sourceDirectory, 'bundle.json'),
        bundle: nativeBundle
      }
    })
  else {
    const overlay = await readFile(join(sourceDirectory, 'artifacts/overlay.png'))
    const previews = []
    for (const region of source.result.regions.filter((r) => r.detector === item.backend)) {
      const artifact = bundle.artifacts.find((a) => a.artifactId === region.cropArtifactId)
      if (artifact)
        previews.push({
          regionId: region.regionId,
          bboxXYWH: region.bboxXYWH,
          dataUrl: `data:image/png;base64,${(await readFile(join(directory, artifact.uri))).toString('base64')}`
        })
    }
    detectors.push({
      ...common,
      regionPreviews: previews,
      localization: {
        decision: 'inconclusive',
        score: null,
        regionCount: item.result.regionCount,
        manipulatedAreaFraction: item.result.areaFraction,
        overlayDataUrl: `data:image/png;base64,${overlay.toString('base64')}`,
        bundlePath: join(sourceDirectory, 'bundle.json'),
        bundle: nativeBundle
      }
    })
  }
}
const report = {
  id: source.taskId,
  imageId: bundle.image.imageId,
  backend: 'workflow',
  mode: 'local',
  createdAt: source.createdAt,
  elapsedMs: source.elapsedMs,
  title: '已标记可疑区域',
  summary: '',
  sections: [],
  disclaimer: '模型标记仅供核查，不能作为已证实篡改的结论。',
  workflow: {
    contentType: 'document',
    primary: 'rise',
    status: 'completed',
    detectors,
    flags: source.result.disagreements,
    bundlePath,
    bundle,
    summary,
    summaryPath: join(directory, 'analysis.json')
  }
}
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const desktop = await electron.launch({ args: [project, '--smoke-test', '--disable-gpu'], env })
const output = join(project, 'work/workflow-layout')
await mkdir(output, { recursive: true })
try {
  const page = await desktop.firstWindow()
  await page.getByRole('heading', { name: '从一张图片开始' }).waitFor()
  await page.screenshot({ path: join(output, 'empty.png'), fullPage: true })
  await desktop.evaluate(
    ({ dialog, ipcMain }, { image, report }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] })
      ipcMain.removeHandler('srdp:analysis:run')
      ipcMain.handle('srdp:analysis:run', () => ({ ok: true, data: report }))
    },
    { image: join(directory, summary.image.original), report }
  )
  await page.getByRole('button', { name: '选择图片', exact: true }).click()
  await page.getByRole('combobox', { name: '图片类型' }).selectOption('document')
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('workflow-overlay').waitFor()
  const checks = []
  for (const width of [1400, 1060]) {
    await desktop.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 920),
      width
    )
    await page.waitForTimeout(200)
    const bounds = await page.evaluate(() => {
      const image = document.querySelector('[data-testid="image-preview"]').getBoundingClientRect()
      const container = document.querySelector('.preview-area').getBoundingClientRect()
      return {
        image: { top: image.top, bottom: image.bottom, left: image.left, right: image.right },
        container: {
          top: container.top,
          bottom: container.bottom,
          left: container.left,
          right: container.right
        },
        overflow: document.documentElement.scrollWidth > innerWidth
      }
    })
    assert.equal(bounds.overflow, false)
    assert.ok(
      bounds.image.top >= bounds.container.top && bounds.image.bottom <= bounds.container.bottom
    )
    assert.ok(
      bounds.image.left >= bounds.container.left && bounds.image.right <= bounds.container.right
    )
    assert.equal(
      await page.getByRole('button', { name: 'HiFi-Net 本地定位', exact: true }).isVisible(),
      false
    )
    await page.screenshot({ path: join(output, `result-${width}.png`), fullPage: true })
    checks.push(`${width}px: image contained, no horizontal overflow, debug models hidden`)
  }
  await page.getByText('查看 JSON 报告', { exact: false }).click()
  assert.equal(
    JSON.parse(await page.getByTestId('workflow-summary-json').textContent()).reportType,
    'manipulation_summary'
  )
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      { passed: true, checks, source: 'replayed verified real evidence; no new inference' },
      null,
      2
    )
  )
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} finally {
  await desktop.close()
}
