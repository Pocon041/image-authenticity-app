import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environment = join(root, '.venv')
const python =
  process.platform === 'win32'
    ? join(environment, 'Scripts/python.exe')
    : join(environment, 'bin/python')
const basePython = process.env.PYTHON || 'python'

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')}`)
}

try {
  await access(python)
} catch {
  run(basePython, ['-m', 'venv', environment])
}
run(python, [
  '-m',
  'pip',
  'install',
  '--disable-pip-version-check',
  '-r',
  join(root, 'backend/provenance/requirements.txt')
])
// The upstream wheel declares opencv-python, while RapidOCR uses its headless
// counterpart. Install the pure-Python decoder without replacing that shared cv2 package.
run(python, [
  '-m',
  'pip',
  'install',
  '--disable-pip-version-check',
  '--no-deps',
  'invisible-watermark==0.2.0'
])
run(python, [
  '-c',
  "import c2pa, cv2, importlib.metadata, pywt; from rapidocr import RapidOCR; print('c2pa-python', importlib.metadata.version('c2pa-python'), 'rapidocr', importlib.metadata.version('rapidocr'), 'onnxruntime', importlib.metadata.version('onnxruntime'), 'invisible-watermark', importlib.metadata.version('invisible-watermark'), 'ready')"
])
console.log(`Provenance verifier ready: ${python}`)
