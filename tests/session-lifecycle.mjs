import assert from 'node:assert/strict'
import { AnalysisSession } from '../src/main/services/analysis-session.ts'
import { AppError } from '../src/main/errors.ts'
import { releaseLocalModel } from '../src/main/services/local-model.ts'

const input = { asset: { id: 'image' }, sourcePath: 'fixture', originalBytes: Buffer.alloc(0) }
let detectionCalls = 0
const session = new AnalysisSession({
  async analyze(_image, context) {
    detectionCalls++
    return { id: context.taskId, imageId: 'image', workflow: { bundle: {} } }
  }
})
session.selectImage(input)
await session.analyze('image', 'first', () => {}, 'workflow')
let generated = 0,
  finish
const first = session.explain('first', async (_report, signal) => {
  generated++
  await new Promise((resolve) => {
    finish = resolve
  })
  signal.throwIfAborted()
  return { mode: 'local' }
})
const duplicate = session.explain('first', async () => {
  throw new Error('duplicate execution')
})
assert.equal(first, duplicate)
await Promise.resolve()
finish()
assert.deepEqual(await first, { mode: 'local' })
assert.equal(generated, 1)
await session.explain('first', async () => {
  throw new Error('cache was ignored')
})

await session.analyze('image', 'second', () => {}, 'workflow')
let released = false
const cancelled = session.explain('second', async (_report, signal) => {
  await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
  // Simulate asynchronous GPU cleanup before rejecting.
  await new Promise((resolve) => setTimeout(resolve, 15))
  released = true
  throw new AppError('CANCELLED', 'stopped')
})
const rejection = assert.rejects(cancelled, (error) => error.code === 'CANCELLED')
await Promise.resolve()
await session.analyze('image', 'third', () => {}, 'workflow')
assert.equal(released, true)
await rejection
assert.equal(detectionCalls, 3)

let stopped
const leaving = session.explain('third', async (_report, signal) => {
  stopped = signal
  await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
  throw new AppError('CANCELLED', 'changed image')
})
const leavingRejection = assert.rejects(leaving, (error) => error.code === 'CANCELLED')
await Promise.resolve()
session.clearImage()
assert.equal(stopped.aborted, true)
await leavingRejection

const fetchBefore = globalThis.fetch
const requests = []
globalThis.fetch = async (url, options) => {
  requests.push({ url, body: JSON.parse(options.body) })
  return new Response('{}')
}
try {
  await releaseLocalModel('https://example.test', 'model')
  assert.equal(requests.length, 0)
  await releaseLocalModel('http://127.0.0.1:11434', 'local-model')
  assert.deepEqual(requests[0].body, { model: 'local-model', keep_alive: 0 })
} finally {
  globalThis.fetch = fetchBefore
}
console.log(
  'Session lifecycle: duplicate calls, completed cache, cancellation/cleanup before next detection, changed images and local-only release passed.'
)
