import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { createRequire } from 'node:module'

if (process.platform !== 'win32')
  throw new Error('This test validates the Windows start.cmd entry.')
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronVersion = createRequire(import.meta.url)('electron/package.json').version
const artifacts = join(project, 'work', 'startup')
await mkdir(artifacts, { recursive: true })
const portServer = createServer()
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve))
const port = portServer.address().port
await new Promise((resolve) => portServer.close(resolve))

const env = {
  ...process.env,
  REMOTE_DEBUGGING_PORT: String(port),
  ELECTRON_CLI_ARGS: '["--smoke-test"]'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL
delete env.ELECTRON_EXEC_PATH
const child = spawn('cmd.exe', ['/d', '/c', 'start.cmd'], {
  cwd: project,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})
let logs = ''
child.stdout.on('data', (data) => {
  logs += data.toString()
})
child.stderr.on('data', (data) => {
  logs += data.toString()
})
let browser
try {
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`start.cmd exited with ${child.exitCode}:\n${logs}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(800)
      })
      if (response.ok) break
    } catch {
      /* Electron has not opened its debugging endpoint yet. */
    }
    await delay(500)
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 10_000 })
  const context = browser.contexts()[0]
  const page = context.pages()[0] ?? (await context.waitForEvent('page', { timeout: 15_000 }))
  await page.getByRole('heading', { name: '从一张图片开始' }).waitFor({ timeout: 15_000 })
  assert.equal(await page.getByTestId('analyze-button').isDisabled(), true)
  assert.equal(await page.evaluate(() => typeof window.desktop.chooseImage), 'function')
  assert.ok(logs.includes(`Electron ${electronVersion} is ready`))
  const result = {
    passed: true,
    entry: 'start.cmd',
    checks: [
      'npm predev prepares Electron',
      'electron-vite launches the desktop process',
      'React workspace and preload bridge are ready'
    ]
  }
  await writeFile(join(artifacts, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser?.close().catch(() => {})
  // Stop only the process tree created by this test, including the dev server.
  if (child.pid && child.exitCode === null) {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  }
  await writeFile(join(artifacts, 'start.log'), logs)
}
