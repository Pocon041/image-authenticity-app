import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { runPythonWorker } from '../src/main/services/python-worker.ts'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'work/python-worker-unit')
await mkdir(output, { recursive: true })
const python = join(root, '.venv/Scripts/python.exe')
const worker = join(output, 'fixture.py')
await writeFile(
  worker,
  `import sys, json, time\nr=json.load(open(sys.argv[-1]))\nif r['mode']=='success': print(json.dumps({'type':'result'}),flush=True)\nif r['mode']=='error':\n print('native diagnostic',file=sys.stderr,flush=True)\n print(json.dumps({'type':'error','code':'INFERENCE_FAILED','message':'fixture failure'}),flush=True)\n sys.exit(1)\nif r['mode']=='wait':\n print(json.dumps({'type':'progress','percent':1,'label':'started'}),flush=True)\n time.sleep(10)\n`
)
for (const mode of ['success', 'error', 'cancel', 'timeout']) {
  const directory = join(output, mode)
  await mkdir(directory, { recursive: true })
  const request = join(directory, 'request.json')
  await writeFile(
    request,
    JSON.stringify({ mode: ['cancel', 'timeout'].includes(mode) ? 'wait' : mode })
  )
  const controller = new AbortController()
  const promise = runPythonWorker({
    pythonPath: python,
    workerPath: worker,
    requestPath: request,
    cwd: root,
    timeoutMs: mode === 'timeout' ? 100 : 5000,
    name: 'fixture',
    imageId: 'fixture',
    context: {
      taskId: mode,
      signal: controller.signal,
      onProgress() {
        if (mode === 'cancel') controller.abort()
      }
    }
  })
  if (mode === 'success') await promise
  else
    await assert.rejects(
      promise,
      (error) =>
        error.code === { error: 'INFERENCE_FAILED', cancel: 'CANCELLED', timeout: 'TIMEOUT' }[mode]
    )
  const diagnostic = JSON.parse(await readFile(join(directory, 'worker.json'), 'utf8'))
  assert.equal(
    diagnostic.status,
    { success: 'completed', error: 'failed', cancel: 'cancelled', timeout: 'timeout' }[mode]
  )
  if (mode === 'error') assert.match(diagnostic.stderr, /native diagnostic/)
}
console.log(
  'Python process lifecycle: completion, structured error, cancellation, timeout and saved diagnostics passed.'
)
