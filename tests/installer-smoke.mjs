import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { _electron as electron } from 'playwright'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'work', `installer-smoke-${Date.now()}`)
await mkdir(output, { recursive: true })
const executableIndex = process.argv.indexOf('--executable')
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const executablePath =
  executableIndex >= 0
    ? resolve(process.argv[executableIndex + 1])
    : join(root, 'dist', `v${version}`, 'win-unpacked/SRDP.exe')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
delete env.SRDP_RUNTIME_ROOT
const checks = []

async function launch(extraEnv = {}, profile = 'clean-profile') {
  return electron.launch({
    executablePath,
    args: ['--smoke-test', '--disable-gpu', `--user-data-dir=${join(output, profile)}`],
    cwd: output,
    env: { ...env, ...extraEnv },
    timeout: 30000
  })
}

let desktop = await launch()
try {
  let page = await desktop.firstWindow()
  await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
  const initial = await page.evaluate(() => window.desktop.runtimeEnvironment())
  assert.equal(initial.ok, true)
  assert.equal(initial.data.packaged, true)
  assert.equal(initial.data.directory, null)
  await page.getByText('尚未选择模型与报告目录', { exact: true }).waitFor()
  checks.push(
    'Clean installed application starts from an unrelated working directory and requests a runtime directory'
  )

  const chosenDirectory = join(output, '独立环境目录')
  await mkdir(chosenDirectory)
  await desktop.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, chosenDirectory)
  await page.getByRole('button', { name: '选择模型与报告目录', exact: true }).click()
  await page.waitForFunction(
    (path) => document.querySelector('[data-testid="runtime-directory"]')?.textContent === path,
    chosenDirectory
  )
  for (const model of ['sica', 'rita', 'rise', 'aigc', 'router', 'explanation'])
    JSON.parse(
      (await readFile(join(chosenDirectory, 'config', `${model}.example.json`), 'utf8')).replace(
        /^\uFEFF/,
        ''
      )
    )
  await readFile(join(chosenDirectory, '安装与模型配置说明.md'))
  checks.push(
    'Native directory selection creates setup templates and guide in the selected external directory'
  )
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
  await page.screenshot({ path: join(output, 'installed-first-run.png'), fullPage: true })
  await desktop.close()

  desktop = await launch()
  page = await desktop.firstWindow()
  await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
  const restored = await page.evaluate(() => window.desktop.runtimeEnvironment())
  assert.equal(restored.data.directory, chosenDirectory)
  checks.push('Runtime directory survives application restart')
  await desktop.close()

  if (process.argv.includes('--real-sica')) {
    desktop = await launch({ SRDP_RUNTIME_ROOT: root }, 'model-profile')
    page = await desktop.firstWindow()
    await page.getByRole('heading', { name: '通用鉴伪系统' }).waitFor()
    const taskId = `installer-sica-${randomUUID()}`
    const imagePath = join(root, 'examples/image/duck.jpg')
    await desktop.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, imagePath)
    const result = await page.evaluate(async (task) => {
      const image = await window.desktop.chooseImage()
      if (!image.ok || !image.data) throw new Error('Image import failed')
      return window.desktop.analyze(image.data.id, task, 'sica')
    }, taskId)
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.data.mode, 'local')
    assert.equal(result.data.backend, 'sica')
    assert.ok(Math.abs(result.data.classification.score - 0.324358731508255) < 1e-5)
    const audit = JSON.parse(
      await readFile(join(root, 'work/sica-runs', taskId, 'worker.json'), 'utf8')
    )
    await writeFile(join(output, 'real-sica.json'), JSON.stringify({ result, audit }, null, 2))
    checks.push(
      'Packaged executable runs real SICA using external configuration and bundled Python worker, retaining the reference score'
    )
  }
  await writeFile(
    join(output, 'result.json'),
    JSON.stringify({ passed: true, executablePath, checks }, null, 2)
  )
  console.log(JSON.stringify({ passed: true, executablePath, checks, output }, null, 2))
} catch (error) {
  const page = desktop.windows()[0]
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
    console.error(await page.locator('body').innerText())
    console.error(await page.evaluate(() => window.desktop.runtimeEnvironment()).catch(String))
  }
  throw error
} finally {
  await desktop.close().catch(() => {})
}
