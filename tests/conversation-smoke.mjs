// UI/progress fixtures only: this test makes no model-quality claims.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { _electron as electron } from 'playwright'
const root = resolve(import.meta.dirname, '..'),
  output = join(root, 'work/conversation-smoke')
await mkdir(output, { recursive: true })
const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#71869d' } })
  .png()
  .toBuffer()
const source = join(output, 'fixture.png'),
  hash = createHash('sha256').update(png).digest('hex')
await writeFile(source, png)
const dataUrl = `data:image/png;base64,${png.toString('base64')}`
const overlayBytes = await sharp({
  create: { width: 640, height: 360, channels: 3, background: '#9b6474' }
})
  .png()
  .toBuffer()
const overlayDataUrl = `data:image/png;base64,${overlayBytes.toString('base64')}`
const bundle = {
  image: { imageId: `sha256:${hash}`, sha256: hash, width: 640, height: 360 },
  reports: [],
  artifacts: []
}
const report = {
  id: 'ui-fixture',
  imageId: `sha256:${hash}`,
  backend: 'workflow',
  mode: 'local',
  createdAt: '2026-11-05T00:00:00Z',
  elapsedMs: 1000,
  title: '已标记可疑区域',
  summary: 'Synthetic UI fixture',
  sections: [],
  disclaimer: 'Synthetic UI fixture',
  workflow: {
    contentType: 'photo',
    primary: 'rita',
    status: 'completed',
    detectors: [
      {
        backend: 'aigc',
        status: 'completed',
        elapsedMs: 1,
        aigc: {
          decision: 'non_ai',
          zScore: -0.01,
          threshold: -2,
          attributedSource: null,
          attributionScore: null,
          bundlePath: 'fixture.json',
          bundle
        }
      },
      {
        backend: 'sica',
        status: 'completed',
        elapsedMs: 1,
        classification: {
          decision: 'real',
          score: 0.32,
          threshold: 0.5,
          checkpointVariant: 'test',
          bundlePath: 'fixture.json',
          bundle
        }
      },
      {
        backend: 'rita',
        status: 'completed',
        elapsedMs: 1,
        localization: {
          decision: 'inconclusive',
          score: 0.99,
          regionCount: 1,
          manipulatedAreaFraction: 0.05,
          overlayDataUrl,
          bundlePath: 'fixture.json',
          bundle
        }
      },
      { backend: 'rise', status: 'not_run', elapsedMs: 0 }
    ],
    flags: ['整图检查与区域检查结果存在分歧。'],
    bundlePath: 'fixture.json',
    bundle,
    summaryPath: 'fixture.json',
    summary: { reportType: 'manipulation_summary' },
    routing: {
      mode: 'auto',
      status: 'completed',
      decision: 'photo',
      scores: { photo: 0.9, document: 0.1 },
      margin: 0.8,
      marginThreshold: 0.15,
      elapsedMs: 1
    }
  }
}
const explanation = {
  schemaVersion: '1.0',
  reportId: 'explanation-ui-fixture',
  imageId: report.imageId,
  taskId: report.id,
  moduleId: 'explanation',
  mode: 'local',
  status: 'completed',
  producer: { name: 'TEST FIXTURE', version: 'test' },
  createdAt: report.createdAt,
  elapsedMs: 1,
  inputReportIds: [],
  evidence: [],
  artifacts: [],
  limitations: [],
  error: null,
  result: {
    finalDecision: 'suspicious',
    decisionSource: 'vlm',
    upstreamDecision: 'inconclusive',
    confidence: { value: null, source: 'unavailable', calibrated: false },
    analysis:
      '### 重点位置\n图片右侧的**水鸟**值得重点核查。\n\n### 分析依据\n- 局部检查集中标记了这只鸟。\n- 整图与局部检查存在分歧。',
    evidenceBalance: '整图检查与局部检查存在差异，建议先查看标记位置。',
    primaryRegionId: 'region-A',
    regionAnalyses: [
      {
        regionId: 'region-A',
        subject: '局部对象',
        location: '图片右侧',
        reason: '局部检查集中标记了这个对象。',
        suspectedOperation: '复制移动',
        operationSource: 'vlm_hypothesis',
        evidenceIds: ['test-evidence']
      }
    ],
    claims: [],
    unresolved: []
  }
}
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
const desktop = await electron.launch({ args: [root, '--smoke-test', '--disable-gpu'], env })
const checks = [],
  errors = []
try {
  const page = await desktop.firstWindow()
  page.setDefaultTimeout(20000)
  page.on('pageerror', (e) => errors.push(e.message))
  await page.getByRole('heading', { name: '从一张图片开始' }).waitFor()
  await desktop.evaluate(
    ({ dialog, ipcMain, BrowserWindow }, { source, report, explanation }) => {
      const state = (globalThis.__conversation = {
        taskId: null,
        imageId: null,
        analyze: null,
        explain: null,
        explainCalls: 0
      })
      state.emit = (progress) =>
        BrowserWindow.getAllWindows()[0].webContents.send('srdp:analysis:progress', {
          imageId: state.imageId,
          taskId: state.taskId,
          stage: 'analyzing',
          percent: 10,
          ...progress
        })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] })
      ipcMain.removeHandler('srdp:analysis:run')
      ipcMain.handle('srdp:analysis:run', (_event, imageId, taskId) => {
        state.taskId = taskId
        state.imageId = imageId
        state.emit({ workflowPhase: 'prepare', label: '正在读取图片和来源信息', steps: [] })
        return new Promise((resolve) => {
          state.analyze = () =>
            resolve({
              ok: true,
              data: {
                ...report,
                id: taskId,
                imageId,
                workflow: state.partial
                  ? {
                      ...report.workflow,
                      status: 'partial',
                      detectors: report.workflow.detectors.map((d) =>
                        d.backend === 'sica'
                          ? {
                              backend: 'sica',
                              status: 'failed',
                              elapsedMs: 1,
                              error: { code: 'TIMEOUT', message: 'Synthetic timeout' }
                            }
                          : d
                      )
                    }
                  : state.dual
                    ? {
                        ...report.workflow,
                        contentType: 'unsure',
                        primary: 'rise',
                        detectors: report.workflow.detectors.map((d) =>
                          d.backend === 'rise'
                            ? {
                                backend: 'rise',
                                status: 'completed',
                                elapsedMs: 1,
                                localization: {
                                  ...report.workflow.detectors.find((d) => d.backend === 'rita')
                                    .localization,
                                  overlayDataUrl: report.workflow.detectors.find(
                                    (d) => d.backend === 'rita'
                                  ).localization.overlayDataUrl
                                }
                              }
                            : d
                        )
                      }
                    : report.workflow
              }
            })
          state.cancel = () => resolve({ ok: false, code: 'CANCELLED', error: 'cancelled' })
        })
      })
      ipcMain.removeHandler('srdp:analysis:explain')
      ipcMain.handle('srdp:analysis:explain', (_event, taskId) => {
        state.explainCalls++
        return new Promise((resolve) => {
          state.explain = () =>
            resolve(
              state.explainFail
                ? { ok: false, error: 'Synthetic explanation failure', code: 'INFERENCE_FAILED' }
                : {
                    ok: true,
                    data: {
                      ...explanation,
                      taskId,
                      ...(state.templateFallback
                        ? { mode: 'mock', producer: { name: 'template-fallback', version: 'test' } }
                        : {})
                    }
                  }
            )
        })
      })
      ipcMain.removeHandler('srdp:analysis:cancel')
      ipcMain.handle('srdp:analysis:cancel', () => {
        state.cancel()
        return { ok: true, data: true }
      })
    },
    { source, report, explanation }
  )
  async function choose() {
    await page
      .getByRole('button', {
        name: (await page.getByTestId('image-name').count()) ? '更换图片' : '选择图片',
        exact: true
      })
      .click()
    await page.getByTestId('image-name').waitFor()
  }
  const emit = (payload) => desktop.evaluate((_, p) => globalThis.__conversation.emit(p), payload)
  await choose()
  const leftBefore = await page.locator('.image-panel').innerHTML()
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-progress-label').waitFor()
  await page.locator('[data-step="prepare"][data-status="running"]').waitFor()
  assert.match(await page.getByTestId('workflow-step-counter').textContent(), /第 1 步/)
  await emit({ workflowPhase: 'routing', label: '正在识别图片内容类型', steps: [] })
  await page.locator('[data-step="routing"][data-status="running"]').waitFor()
  const steps = [
    { backend: 'aigc', status: 'completed', message: '未发现明显的图像生成线索。' },
    { backend: 'sica', status: 'completed', message: '整图检查已完成。' },
    { backend: 'rita', status: 'running' }
  ]
  await emit({
    workflowPhase: 'detectors',
    routingStatus: 'completed',
    label: '正在检查局部区域',
    steps,
    percent: 60
  })
  await page.locator('[data-step="rita"][data-status="running"]').waitFor()
  assert.match(await page.getByTestId('workflow-step-counter').textContent(), /第 5 步 \/ 共 7 步/)
  assert.ok(await page.getByText('未发现明显的图像生成线索。', { exact: true }).isVisible())
  assert.equal(await page.locator('[data-step="aggregate"]').count(), 0)
  await page.screenshot({ path: join(output, 'progress.png'), fullPage: true })
  checks.push(
    'real IPC events reveal ordered loading messages, key information and exact step count'
  )
  steps[2] = { backend: 'rita', status: 'completed', message: '已标记 1 处候选区域。' }
  steps[2].preview = { overlayDataUrl: dataUrl, regionCount: 1, manipulatedAreaFraction: 0.05 }
  await emit({ workflowPhase: 'detectors', label: 'RITA检查完成', steps, percent: 90 })
  await page.getByTestId('step-preview-rita').locator('summary').click()
  await page.getByRole('img', { name: 'RITA定位叠加', exact: true }).waitFor()
  assert.equal(await page.getByTestId('workflow-technical-details').count(), 0)
  await page.getByRole('button', { name: '原图', exact: true }).click()
  await page.getByRole('img', { name: 'RITA原图', exact: true }).waitFor()
  await page.getByRole('button', { name: '放大 RITA 定位结果', exact: true }).click()
  const localizationDialog = page.getByRole('dialog', { name: 'RITA定位大图', exact: true })
  await localizationDialog.waitFor()
  await localizationDialog.getByRole('button', { name: '原始比例', exact: true }).click()
  assert.ok(await localizationDialog.locator('.actual-size').count())
  await localizationDialog.getByRole('button', { name: '定位叠加', exact: true }).click()
  await page.keyboard.press('Escape')
  await localizationDialog.waitFor({ state: 'detached' })
  await emit({
    workflowPhase: 'detectors',
    label: '定位图已缓存，继续整理',
    steps: steps.map(({ preview, ...step }) => step),
    percent: 91
  })
  await page.getByRole('img', { name: 'RITA定位叠加', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'intermediate-preview.png'), fullPage: true })
  checks.push(
    'localization can be expanded and compared with the original before the final report exists'
  )
  await emit({ workflowPhase: 'aggregate', label: '正在整理结果', steps, percent: 95 })
  await desktop.evaluate(() => globalThis.__conversation.analyze())
  await page.locator('[data-step="explanation"][data-status="running"]').waitFor()
  const imageViews = page.getByTestId('image-result-views')
  await imageViews.waitFor()
  assert.equal(
    await imageViews
      .getByRole('button', { name: 'RITA 定位', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  )
  assert.equal(await page.getByTestId('image-preview').getAttribute('src'), overlayDataUrl)
  await imageViews.getByRole('button', { name: '原图', exact: true }).click()
  assert.equal(await page.getByTestId('image-preview').getAttribute('src'), dataUrl)
  await imageViews.getByRole('button', { name: 'RITA 定位', exact: true }).click()
  await page.getByRole('button', { name: '放大查看图像预览', exact: true }).click()
  const leftDialog = page.getByRole('dialog', { name: '图像预览：fixture.png', exact: true })
  assert.equal(await leftDialog.locator('img').getAttribute('src'), overlayDataUrl)
  await page.keyboard.press('Escape')
  checks.push(
    'completed localization replaces the left image by default; original comparison and enlarged preview follow the selected view'
  )
  assert.equal(await desktop.evaluate(() => globalThis.__conversation.explainCalls), 1)
  const emitExplanation = (payload) =>
    desktop.evaluate(
      ({ BrowserWindow }, payload) =>
        BrowserWindow.getAllWindows()[0].webContents.send('srdp:analysis:explanation-progress', {
          taskId: globalThis.__conversation.taskId,
          imageId: globalThis.__conversation.imageId,
          ...payload
        }),
      payload
    )
  await emitExplanation({
    phase: 'synthesizing',
    label: '正在生成分析说明',
    decision: 'suspicious',
    text: '图片右侧的水鸟'
  })
  await page.getByTestId('explanation-summary').waitFor()
  assert.equal(await page.getByTestId('explanation-summary').textContent(), '图片右侧的水鸟')
  assert.match(await page.getByTestId('explanation-conclusion').innerText(), /发现可疑线索/)
  await emitExplanation({
    taskId: 'unrelated-task',
    phase: 'synthesizing',
    label: 'stale',
    text: 'STALE'
  })
  assert.equal(await page.getByTestId('explanation-summary').textContent(), '图片右侧的水鸟')
  await page.screenshot({ path: join(output, 'streaming.png'), fullPage: true })
  await desktop.evaluate(() => globalThis.__conversation.explain())
  await page.getByRole('heading', { name: '分析说明', exact: true }).waitFor()
  assert.match(await page.getByTestId('explanation-conclusion').innerText(), /发现可疑线索/)
  assert.equal(
    await page.getByTestId('explanation-summary').getByRole('heading', { level: 4 }).count(),
    2
  )
  assert.equal(await page.getByTestId('explanation-summary').locator('ul > li').count(), 2)
  assert.equal(
    await page
      .getByTestId('analysis-report')
      .evaluate(
        (node) =>
          !!(
            node
              .querySelector('[data-testid="explanation-conclusion"]')
              .compareDocumentPosition(node.querySelector('[data-testid="explanation-summary"]')) &
            Node.DOCUMENT_POSITION_FOLLOWING
          )
      ),
    true
  )
  assert.ok(
    await page
      .getByTestId('explanation-conclusion')
      .evaluate((node) => getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)')
  )
  assert.equal(await page.getByTestId('explanation-region').count(), 0)
  assert.match(await page.getByTestId('explanation-summary').innerText(), /图片右侧的水鸟/)
  assert.equal(await page.locator('.conversation-activity').getAttribute('open'), null)
  assert.equal(await page.getByTestId('workflow-technical-details').getAttribute('open'), null)
  assert.ok(
    !/SICA|FSD|RITA|RiSE|阈值|z-score/.test(await page.getByTestId('analysis-report').innerText())
  )
  checks.push(
    'one automatic explanation streams genuine events, rejects stale tasks, and ends with prose only and collapsed activity'
  )
  checks.push(
    'actual VLM conclusion appears before the explanation with a distinct highlight; Markdown headings and evidence bullets render clearly'
  )
  for (const width of [1400, 1060]) {
    await desktop.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 920),
      width
    )
    await page.waitForTimeout(100)
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false
    )
    await page.screenshot({ path: join(output, `result-${width}.png`), fullPage: true })
  }
  checks.push('1400px and 1060px layouts have no horizontal overflow')
  await choose()
  await page.getByTestId('image-result-views').waitFor({ state: 'detached' })
  assert.equal(await page.getByTestId('image-result-views').count(), 0)
  assert.equal(await page.getByTestId('image-preview').getAttribute('src'), dataUrl)
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-progress-label').waitFor()
  await page.getByRole('button', { name: '取消分析', exact: true }).click()
  await page.getByText('分析已停止', { exact: true }).waitFor()
  assert.equal(await desktop.evaluate(() => globalThis.__conversation.explainCalls), 1)
  checks.push('cancelled detection stops its timeline and never requests an explanation')
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-progress-label').waitFor()
  await emit({ workflowPhase: 'aggregate', label: '整理完成', steps, percent: 95 })
  await desktop.evaluate(() => globalThis.__conversation.analyze())
  await page.locator('[data-step="explanation"][data-status="running"]').waitFor()
  await choose()
  await desktop.evaluate(() => globalThis.__conversation.explain())
  await page.waitForTimeout(150)
  assert.equal(await page.getByTestId('explanation-summary').count(), 0)
  await desktop.evaluate(() => {
    globalThis.__conversation.partial = true
    globalThis.__conversation.explainFail = true
  })
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-progress-label').waitFor()
  await emit({
    workflowPhase: 'aggregate',
    label: '部分检查结果已整理',
    steps: steps.map((s) =>
      s.backend === 'sica'
        ? { backend: 'sica', status: 'failed', message: '这项检查未完成，继续保留其他检查结果。' }
        : s
    ),
    percent: 95
  })
  await desktop.evaluate(() => globalThis.__conversation.analyze())
  await page.locator('[data-step="explanation"][data-status="running"]').waitFor()
  await desktop.evaluate(() => globalThis.__conversation.explain())
  await page.getByRole('button', { name: '重新生成说明', exact: true }).waitFor()
  assert.equal(await page.locator('[data-step="sica"]').getAttribute('data-status'), 'failed')
  assert.equal(await page.getByTestId('workflow-technical-details').count(), 1)
  await desktop.evaluate(() => {
    globalThis.__conversation.explainFail = false
  })
  await page.getByRole('button', { name: '重新生成说明', exact: true }).click()
  await page.locator('[data-step="explanation"][data-status="running"]').waitFor()
  await desktop.evaluate(() => globalThis.__conversation.explain())
  await page.getByTestId('explanation-summary').waitFor()
  checks.push(
    'partial detection and explanation failure retain reports; retry successfully generates a result'
  )
  await choose()
  await desktop.evaluate(() => {
    globalThis.__conversation.templateFallback = true
  })
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-progress-label').waitFor()
  await emit({ workflowPhase: 'aggregate', label: '整理完成', steps, percent: 95 })
  await desktop.evaluate(() => globalThis.__conversation.analyze())
  await page.locator('[data-step="explanation"][data-status="running"]').waitFor()
  await desktop.evaluate(() => globalThis.__conversation.explain())
  await page.getByRole('button', { name: '重新生成说明', exact: true }).waitFor()
  assert.equal(await page.getByTestId('analysis-report').count(), 0)
  assert.equal(await page.getByTestId('workflow-technical-details').count(), 1)
  checks.push(
    'template fallback remains in diagnostics and is never displayed as the final VLM answer'
  )
  await desktop.evaluate(() => {
    globalThis.__conversation.dual = true
    globalThis.__conversation.partial = false
    globalThis.__conversation.templateFallback = false
  })
  await choose()
  await page.getByTestId('analyze-button').click()
  await page.getByTestId('analysis-progress-label').waitFor()
  await emit({ workflowPhase: 'aggregate', label: '整理完成', steps, percent: 95 })
  await desktop.evaluate(() => globalThis.__conversation.analyze())
  await page
    .getByTestId('image-result-views')
    .getByRole('button', { name: 'RiSE 定位', exact: true })
    .waitFor()
  assert.equal(
    await page
      .getByTestId('image-result-views')
      .getByRole('button', { name: 'RiSE 定位', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  )
  await page
    .getByTestId('image-result-views')
    .getByRole('button', { name: 'RITA 定位', exact: true })
    .click()
  assert.equal(
    await page
      .getByTestId('image-result-views')
      .getByRole('button', { name: 'RITA 定位', exact: true })
      .getAttribute('aria-pressed'),
    'true'
  )
  checks.push(
    'multiple localizers remain independently selectable; the completed report primary selects the initial left view'
  )
  assert.deepEqual(errors, [])
  assert.ok(leftBefore.includes('image-preview'))
  checks.push('late explanation is discarded after choosing another image; no renderer errors')
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify(
      { passed: true, checks, errors, mode: 'synthetic IPC and model responses; no inference' },
      null,
      2
    )
  )
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} catch (error) {
  await (
    await desktop.firstWindow()
  )
    .screenshot({ path: join(output, 'failure.png'), fullPage: true })
    .catch(() => {})
  throw error
} finally {
  await desktop.close()
}
