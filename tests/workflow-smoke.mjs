import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import sharp from 'sharp'

const project = resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const image = resolve(
  option('--image', join(project, 'examples/stage1-materials/sample-003/images/original.jpg'))
)
const negativeImage = option('--negative-image')
const output = join(project, 'work/workflow-smoke')
await mkdir(output, { recursive: true })
const configPath = join(output, 'sica.local.json')
const realConfig = JSON.parse(
  (
    await readFile(
      resolve(project, process.env.SRDP_SICA_CONFIG ?? 'config/sica.local.json'),
      'utf8'
    )
  ).replace(/^\uFEFF/, '')
)
await writeFile(configPath, JSON.stringify(realConfig))
const env = { ...process.env, SRDP_SICA_CONFIG: configPath }
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
const checks = [],
  errors = [],
  requests = []
const validate = (path) =>
  execFileSync(
    process.execPath,
    [join(project, 'scripts/validate-report-examples.mjs'), '--bundle', path],
    { cwd: project, encoding: 'utf8' }
  ).trim()
try {
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url())
  })
  await page.getByRole('heading', { name: '从一张图片开始' }).waitFor()
  assert.equal(await page.getByRole('combobox', { name: '图片类型' }).inputValue(), 'unsure')
  assert.equal(
    await page.getByRole('button', { name: 'HiFi-Net 本地定位', exact: true }).isVisible(),
    false
  )
  assert.equal(await page.getByTestId('analyze-button').isDisabled(), true)
  await page.screenshot({ path: join(output, '01-empty.png'), fullPage: true })
  checks.push('default unified entry, unsure routing, debug models hidden')
  async function choose(path) {
    await desktop.evaluate(({ dialog }, imagePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [imagePath] })
    }, path)
    await page
      .getByRole('button', {
        name: (await page.getByTestId('image-name').count()) ? '更换图片' : '选择图片',
        exact: true
      })
      .click()
    await page.getByTestId('image-name').waitFor()
  }
  async function result() {
    await page.getByTestId('workflow-bundle').waitFor({ state: 'attached', timeout: 600000 })
    return JSON.parse(await page.getByTestId('workflow-bundle').textContent())
  }
  await choose(image)
  await page.getByRole('combobox', { name: '图片类型' }).selectOption('document')
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('workflow-progress').waitFor()
  const document = await result(),
    first = document.reports[0]
  assert.equal(document.reports.length, 2)
  assert.equal(document.reports[1].moduleId, 'provenance')
  assert.equal(document.reports[1].evidence.length, 4)
  const provenancePath = join(
    project,
    'work/analysis-runs',
    first.taskId,
    'reports/provenance.json'
  )
  assert.equal(JSON.parse(await readFile(provenancePath, 'utf8')).moduleId, 'provenance')
  assert.equal(first.producer.name, 'manipulation-workflow')
  assert.equal(first.result.score, null)
  assert.equal(first.result.decision, 'inconclusive')
  assert.deepEqual(
    first.result.detectors.map((d) => [d.backend, d.status]),
    [
      ['sica', 'completed'],
      ['rise', 'completed'],
      ['rita', 'not_run']
    ]
  )
  const firstPath = join(project, 'work/analysis-runs', first.taskId, 'bundle.json')
  validate(firstPath)
  const concisePath = join(project, 'work/analysis-runs', first.taskId, 'analysis.json')
  const concise = JSON.parse(await readFile(concisePath, 'utf8'))
  assert.equal(concise.reportType, 'manipulation_summary')
  assert.equal(concise.localization.find((d) => d.model.id === 'rise').status, 'completed')
  assert.equal(JSON.stringify(concise).includes('sourceFiles'), false)
  assert.equal(JSON.stringify(concise).includes('expertSelectionConfidence'), false)
  execFileSync(
    process.execPath,
    [join(project, 'scripts/validate-manipulation-summary.mjs'), concisePath],
    { cwd: project }
  )
  await desktop.evaluate(({ shell }) => {
    global.__openedEvidence = null
    shell.openPath = async (path) => {
      global.__openedEvidence = path
      return ''
    }
  })
  await page.getByRole('button', { name: '打开报告文件夹', exact: true }).click()
  assert.equal(
    await desktop.evaluate(() => global.__openedEvidence),
    join(project, 'work/analysis-runs', first.taskId)
  )
  assert.equal(document.artifacts.filter((a) => ['original', 'display'].includes(a.type)).length, 2)
  await page.screenshot({ path: join(output, '02-document.png'), fullPage: true })
  checks.push('real SICA + RiSE document workflow with linked provenance and manipulation reports')

  await page.getByTestId('supplement-button').click()
  const augmented = await result(),
    combined = augmented.reports[0]
  assert.equal(combined.extensions.previousTaskId, first.taskId)
  assert.equal(combined.result.detectors.filter((d) => d.reused).length, 2)
  assert.equal(combined.result.detectors.find((d) => d.backend === 'rita').status, 'completed')
  await assert.rejects(access(join(project, 'work/sica-runs', `${combined.taskId}-sica`)))
  await assert.rejects(access(join(project, 'work/rise-runs', `${combined.taskId}-rise`)))
  const combinedPath = join(project, 'work/analysis-runs', combined.taskId, 'bundle.json')
  validate(combinedPath)
  assert.equal(augmented.artifacts.filter((a) => a.type === 'mask').length, 2)
  await page.getByTestId('localizer-rita').click()
  assert.match(await page.getByTestId('workflow-overlay').getAttribute('alt'), /RITA/)
  await page.getByTestId('localizer-rise').click()
  await page.getByRole('button', { name: '原图', exact: true }).click()
  assert.match(await page.getByTestId('workflow-overlay').getAttribute('alt'), /原图预览/)
  await page.getByRole('button', { name: '叠加定位', exact: true }).click()
  const crops = page.getByText('查看区域裁剪', { exact: false })
  if (await crops.count()) await crops.click()
  await page.screenshot({ path: join(output, '03-supplement.png'), fullPage: true })
  checks.push(
    'supplement only runs RITA, reuses completed evidence, separates masks and switches original/overlay/crops'
  )

  const invalid = await page.evaluate(async (imageId) => {
    const badType = await window.desktop.analyze(imageId, crypto.randomUUID(), 'workflow', {
      contentType: ['photo']
    })
    const stale = await window.desktop.analyze(imageId, crypto.randomUUID(), 'workflow', {
      contentType: 'document',
      supplementFromTaskId: 'stale-reference'
    })
    return { badType, stale }
  }, document.image.imageId)
  assert.equal(invalid.badType.code, 'INVALID_REQUEST')
  assert.equal(invalid.stale.code, 'STALE_IMAGE')
  checks.push('invalid route options and stale supplement task references are rejected')

  await writeFile(
    configPath,
    JSON.stringify({ ...realConfig, checkpointPath: 'work/workflow-smoke/known-missing.pth' })
  )
  await page.getByRole('combobox', { name: '图片类型' }).selectOption('photo')
  await page.getByTestId('analyze-button').click()
  const partial = await result()
  assert.equal(partial.reports[0].result.executionStatus, 'partial')
  assert.equal(
    partial.reports[0].result.detectors.find((d) => d.backend === 'sica').status,
    'failed'
  )
  assert.equal(
    partial.reports[0].result.detectors.find((d) => d.backend === 'rita').status,
    'completed'
  )
  await page.getByTestId('workflow-flags').waitFor()
  validate(join(project, 'work/analysis-runs', partial.reports[0].taskId, 'bundle.json'))
  await page.screenshot({ path: join(output, '04-partial.png'), fullPage: true })
  checks.push('missing SICA weights preserves real RITA output and visible partial-failure status')
  await writeFile(configPath, JSON.stringify(realConfig))

  if (negativeImage) {
    await choose(resolve(negativeImage))
    await page.getByTestId('analyze-button').click()
    const negative = await result(),
      detectors = negative.reports[0].result.detectors
    assert.equal(
      detectors.find((d) => d.backend === 'sica').result.classification.predictedClass,
      'real'
    )
    assert.equal(detectors.find((d) => d.backend === 'rita').status, 'completed')
    assert.ok(detectors.find((d) => d.backend === 'rita').result.regionCount > 0)
    await page.getByTestId('workflow-flags').waitFor()
    validate(join(project, 'work/analysis-runs', negative.reports[0].taskId, 'bundle.json'))
    await page.screenshot({ path: join(output, '05-negative-screening.png'), fullPage: true })
    checks.push(
      'real SICA-negative tampered example still receives RITA localization and disagreement flag'
    )
  }

  // Ensure cancellation has multiple tiles remaining, independent of the user's image size.
  const cancellationImage = join(output, 'cancellation-fixture.png')
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#a0a0a0' } })
    .png()
    .toFile(cancellationImage)
  await choose(cancellationImage)
  await page.getByRole('combobox', { name: '图片类型' }).selectOption('unsure')
  await page.evaluate(() => {
    window.__workflowTask = null
    window.__stopProgress = window.desktop.onAnalysisProgress((p) => {
      window.__workflowTask = p.taskId
    })
  })
  await page.getByTestId('analyze-button').click()
  await page
    .getByTestId('analysis-progress-label')
    .filter({ hasText: 'RiSE · RiSE 分块推理 1/' })
    .waitFor({ timeout: 180000 })
  await page.getByRole('button', { name: '取消分析', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已取消' }).waitFor()
  const cancelledId = await page.evaluate(() => {
    window.__stopProgress()
    return window.__workflowTask
  })
  await assert.rejects(access(join(project, 'work/analysis-runs', cancelledId, 'bundle.json')))
  await assert.rejects(
    access(join(project, 'work/rise-runs', `${cancelledId}-rise`, 'bundle.json'))
  )
  assert.equal(
    JSON.parse(await readFile(join(project, 'work/analysis-runs', cancelledId, 'run.json'))).status,
    'cancelled'
  )
  checks.push(
    'UI cancellation during real RiSE tile inference leaves no completed model or workflow bundle'
  )

  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1060, 740))
  await page.waitForTimeout(250)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  assert.deepEqual(requests, [])
  const prefs = await desktop.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  )
  assert.equal(prefs.contextIsolation, true)
  assert.equal(prefs.sandbox, true)
  assert.equal(prefs.nodeIntegration, false)
  checks.push('minimum-width layout, process isolation and no renderer exceptions or remote HTTP')
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      { passed: true, checks, documentBundle: firstPath, supplementedBundle: combinedPath },
      null,
      2
    )
  )
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} finally {
  await desktop.close()
}
