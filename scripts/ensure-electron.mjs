import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
let electronDirectory, version
try {
  electronDirectory = dirname(require.resolve('electron/package.json'))
  version = require('electron/package.json').version
} catch {
  console.error(
    '[runtime] Electron package is missing. From the project directory, run `run.cmd ci --include=dev`, then retry `start.cmd`.'
  )
  process.exit(1)
}

function runtimeReady() {
  try {
    const relativePath = readFileSync(join(electronDirectory, 'path.txt'), 'utf8').trim()
    const installedVersion = readFileSync(join(electronDirectory, 'dist/version'), 'utf8')
      .trim()
      .replace(/^v/, '')
    return (
      relativePath &&
      installedVersion === version &&
      existsSync(join(electronDirectory, 'dist', relativePath))
    )
  } catch {
    return false
  }
}

if (!runtimeReady() || process.argv.includes('--repair')) {
  console.log(`[runtime] Preparing Electron ${version} (${process.platform}-${process.arch})...`)
  const installerEnv = { ...process.env }
  // A parent PowerShell 7 may pass incompatible module paths to Windows PowerShell 5.1.
  for (const key of Object.keys(installerEnv)) {
    if (key.toLowerCase() === 'psmodulepath') delete installerEnv[key]
  }
  installerEnv.PSModulePath = join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/Modules'
  )
  const installer =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(dirname(fileURLToPath(import.meta.url)), 'install-electron.ps1'),
            '-Architecture',
            process.arch
          ],
          { stdio: 'inherit', windowsHide: true, env: installerEnv }
        )
      : spawnSync(process.execPath, [join(electronDirectory, 'install.js')], { stdio: 'inherit' })
  if (installer.error || installer.status !== 0 || !runtimeReady()) {
    console.error(
      '[runtime] Electron setup failed. Check the download error above, then rerun npm run runtime:ensure.'
    )
    process.exit(1)
  }
}

console.log(`[runtime] Electron ${version} is ready.`)
