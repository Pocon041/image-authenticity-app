import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const mode = args.shift()
if (!['evaluate', 'infer'].includes(mode)) throw new Error('Expected evaluate or infer')
const configPath = resolve(
  root,
  args.includes('--config') ? args[args.indexOf('--config') + 1] : 'config/hifi.local.json'
)
const config = JSON.parse((await readFile(configPath, 'utf8')).replace(/^\uFEFF/, ''))
const python =
  config.pythonPath.includes('/') || config.pythonPath.includes('\\')
    ? resolve(root, config.pythonPath)
    : config.pythonPath
const child = spawn(python, ['-u', join(root, `backend/hifi/${mode}.py`), ...args], {
  cwd: root,
  windowsHide: true,
  stdio: 'inherit',
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
})
const cancel = () => child.kill()
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('close', (code) => {
  process.removeListener('SIGINT', cancel)
  process.removeListener('SIGTERM', cancel)
  process.exitCode = code ?? 1
})
