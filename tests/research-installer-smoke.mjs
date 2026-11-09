import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'work', `research-installer-smoke-${Date.now()}`)
await mkdir(output, { recursive: true })
const reuseIndex = process.argv.indexOf('--reuse-data')
const dataDirectory =
  reuseIndex >= 0 ? resolve(process.argv[reuseIndex + 1]) : join(output, '科研数据')
await mkdir(dataDirectory, { recursive: true })
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version
const bundle = join(root, 'dist/research-runtime-v1/runtime-bundle')
const env = { ...process.env, SRDP_BUNDLE_DIR: bundle }
if (process.argv.includes('--native-bundle-source')) delete env.SRDP_BUNDLE_DIR
for (const name of [
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_RENDERER_URL',
  'SRDP_RUNTIME_ROOT',
  'PYTHONHOME',
  'PYTHONPATH'
])
  delete env[name]
const args = ['--smoke-test', '--disable-gpu', `--user-data-dir=${join(output, 'profile')}`]
const executableIndex = process.argv.indexOf('--executable')
const executablePath =
  executableIndex >= 0
    ? resolve(process.argv[executableIndex + 1])
    : join(root, 'dist', `v${version}`, 'win-unpacked/SRDP.exe')
let desktop = await electron.launch({ executablePath, args, cwd: output, env, timeout: 30000 })
let runtimeLog = ''
for (const stream of [desktop.process().stdout, desktop.process().stderr])
  stream?.on('data', (data) => {
    runtimeLog = (runtimeLog + data.toString()).slice(-256000)
  })
const checks = []
try {
  let page = await desktop.firstWindow()
  page.setDefaultTimeout(600000)
  await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, dataDirectory)
  await page.getByRole('button', { name: '选择数据目录并自动配置', exact: true }).click()
  if (reuseIndex >= 0) {
    await page.waitForFunction(
      (path) => document.querySelector('[data-testid="runtime-directory"]')?.textContent === path,
      dataDirectory
    )
    const checked = await page.evaluate(() => window.desktop.prepareRuntime())
    assert.equal(checked.ok, true, JSON.stringify(checked))
  }
  await page.waitForFunction(
    () => {
      const stage = document
        .querySelector('[data-testid="runtime-setup-progress"]')
        ?.getAttribute('data-stage')
      return ['completed', 'failed', 'cancelled'].includes(stage)
    },
    undefined,
    { timeout: 600000 }
  )
  const info = await page.evaluate(() => window.desktop.runtimeEnvironment())
  assert.equal(info.ok, true)
  assert.equal(info.data.setup.ready, true, JSON.stringify(info))
  assert.equal(info.data.setup.progress.stage, 'completed', JSON.stringify(info))
  assert.equal(info.data.configurations.filter((item) => item.configured).length, 7)
  checks.push(reuseIndex >= 0
    ? 'Previously provisioned Python, official checkpoints, model sources and private 2B service are rechecked successfully'
    : 'An empty data directory is automatically provisioned with Python, official checkpoints, model sources and a private 2B Ollama service')
  for (const name of ['rita', 'sica', 'rise', 'aigc', 'router', 'provenance']) {
    const config = JSON.parse(
      await readFile(join(dataDirectory, 'config', `${name}.local.json`), 'utf8')
    )
    for (const [key, value] of Object.entries(config)) {
      if (key.endsWith('Path'))
        assert.ok(value.startsWith(dataDirectory), `${name}.${key} escaped selected directory`)
    }
  }
  checks.push(
    'Generated runtime, model and dependency paths are contained in the selected data directory'
  )
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
  await page.screenshot({ path: join(output, 'setup-complete.png'), fullPage: true })

  async function selectFile(path) {
    await desktop.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
    }, path)
    const chosen = await page.evaluate(() => window.desktop.chooseImage())
    assert.equal(chosen.ok, true)
    return chosen.data.id
  }

  const imageId = await selectFile(join(root, 'examples/image/duck.jpg'))
  const task = `research-photo-${randomUUID()}`
  const report = await page.evaluate(
    ({ imageId, task }) =>
      window.desktop.analyze(imageId, task, 'workflow', { contentType: 'photo' }),
    { imageId, task }
  )
  assert.equal(report.ok, true, JSON.stringify(report))
  assert.equal(
    report.data.workflow.status,
    'completed',
    JSON.stringify(
      report.data.workflow.detectors.map((item) => ({
        backend: item.backend,
        status: item.status,
        error: item.error
      }))
    )
  )
  const explanation = await page.evaluate((task) => window.desktop.explain(task), task)
  assert.equal(explanation.ok, true, JSON.stringify(explanation))
  assert.equal(explanation.data.mode, 'local', JSON.stringify(explanation.data.error))
  assert.match(explanation.data.producer.name, /srdp-qwen3-vl-2b/)
  await writeFile(join(output, 'photo-report.json'), JSON.stringify(report.data, null, 2))
  await writeFile(join(output, 'photo-explanation.json'), JSON.stringify(explanation.data, null, 2))
  checks.push(
    'Real provenance, FSD, SICA, RITA and local 2B explanation complete from the freshly provisioned environment'
  )

  const document = join(output, 'document.png')
  await sharp(join(root, 'examples/image/doc.png'))
    .extract({ left: 0, top: 600, width: 512, height: 512 })
    .png()
    .toFile(document)
  const documentId = await selectFile(document)
  const rise = await page.evaluate(
    ({ imageId, task }) => window.desktop.analyze(imageId, task, 'rise'),
    { imageId: documentId, task: `research-rise-${randomUUID()}` }
  )
  assert.equal(rise.ok, true, JSON.stringify(rise))
  assert.equal(rise.data.mode, 'local')
  await writeFile(join(output, 'rise-report.json'), JSON.stringify(rise.data, null, 2))
  checks.push('Real RiSE-9 inference runs with bundled Python and isolated dependencies')
  await desktop.close()
  desktop = await electron.launch({ executablePath, args, cwd: output, env, timeout: 30000 })
  page = await desktop.firstWindow()
  await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
  const restored = await page.evaluate(() => window.desktop.runtimeEnvironment())
  assert.equal(restored.data.setup.ready, true)
  const tags = await (await fetch('http://127.0.0.1:11435/api/tags')).json()
  assert.ok(tags.models.some((model) => model.name === 'srdp-qwen3-vl-2b:latest'))
  checks.push(
    'Restart restores the selected environment and automatically starts the private model service'
  )
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify({ passed: true, checks, dataDirectory, output }, null, 2)
  )
  console.log(JSON.stringify({ passed: true, checks, dataDirectory, output }, null, 2))
} catch (error) {
  const page = desktop.windows()[0]
  if (page) {
    await writeFile(join(output, 'failure.txt'), await page.locator('body').innerText()).catch(
      () => {}
    )
    const state = await page.evaluate(() => window.desktop.runtimeEnvironment()).catch(String)
    console.error(JSON.stringify(state))
  }
  throw error
} finally {
  await writeFile(join(output, 'main.log'), runtimeLog)
  await desktop.close().catch(() => {})
}
