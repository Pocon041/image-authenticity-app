import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configuration = JSON.parse(
  (await readFile(join(root, 'config/sica.local.json'), 'utf8')).replace(/^\uFEFF/, '')
)
const python =
  configuration.pythonPath.includes('/') || configuration.pythonPath.includes('\\')
    ? resolve(root, configuration.pythonPath)
    : configuration.pythonPath
const script = join(root, 'scripts/build-research-bundle.py')
const manifest = join(root, 'dist/research-runtime-v1/runtime-bundle/manifest.json')
let rebuild = process.argv.includes('--rebuild-runtime')
try {
  await access(manifest)
} catch {
  rebuild = true
}

async function run(args) {
  const child = spawn(python, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  })
  const code = await new Promise((accept, reject) => {
    child.once('error', reject)
    child.once('exit', accept)
  })
  if (code !== 0) throw new Error(`Research bundle build failed with exit code ${code}`)
}

if (rebuild) await run([])
await run(['--assemble-only'])
