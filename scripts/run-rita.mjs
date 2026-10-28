import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const imageArgument = option('--image')
if (!imageArgument)
  throw new Error(
    'Usage: npm.cmd run rita:infer -- --image <image> [--output <directory>] [--config <config>]'
  )
const config = JSON.parse(
  (await readFile(resolve(root, option('--config', 'config/rita.local.json')), 'utf8')).replace(
    /^\uFEFF/,
    ''
  )
)
const source = resolve(imageArgument)
const bytes = await readFile(source)
const hash = createHash('sha256').update(bytes).digest('hex')
const output = resolve(root, option('--output', `work/rita-cli/${randomUUID()}`))
await mkdir(join(output, 'images'), { recursive: true })
const info = await sharp(bytes, { limitInputPixels: 60000000 }).metadata()
if (!['jpeg', 'png', 'webp'].includes(info.format))
  throw new Error('Only JPEG/PNG/WebP are supported')
const originalUri = `images/original.${info.format === 'jpeg' ? 'jpg' : info.format}`
const displayBytes = await sharp(bytes).rotate().toColourspace('srgb').png().toBuffer()
const displayInfo = await sharp(displayBytes).metadata()
await writeFile(join(output, originalUri), bytes)
await writeFile(join(output, 'images/display.png'), displayBytes)
const image = {
  imageId: `sha256:${hash}`,
  sha256: hash,
  originalArtifactId: `${hash}:original`,
  displayArtifactId: `${hash}:display`,
  encodedWidth: info.width,
  encodedHeight: info.height,
  width: displayInfo.width,
  height: displayInfo.height,
  exifOrientation: info.orientation ?? 1,
  coordinateSpace: 'display_image_pixels',
  displayTransform: 'exif_auto_orient_no_resize'
}
const imageArtifacts = [
  {
    artifactId: image.originalArtifactId,
    type: 'original',
    uri: originalUri,
    mediaType: `image/${info.format}`,
    sha256: hash,
    width: info.width,
    height: info.height,
    coordinateSpace: 'encoded_file_pixels',
    bboxXYWH: null,
    sourceArtifactId: null,
    origin: 'original'
  },
  {
    artifactId: image.displayArtifactId,
    type: 'display',
    uri: 'images/display.png',
    mediaType: 'image/png',
    sha256: createHash('sha256').update(displayBytes).digest('hex'),
    width: image.width,
    height: image.height,
    coordinateSpace: 'display_image_pixels',
    bboxXYWH: null,
    sourceArtifactId: image.originalArtifactId,
    origin: 'derived'
  }
]
const pythonPath =
  config.pythonPath.includes('/') || config.pythonPath.includes('\\')
    ? resolve(root, config.pythonPath)
    : config.pythonPath
const requestFile = join(output, 'request.local.json')
await writeFile(
  requestFile,
  JSON.stringify({
    ...config,
    upstreamPath: resolve(root, config.upstreamPath),
    checkpointPath: resolve(root, config.checkpointPath),
    originalPath: join(output, originalUri),
    displayPath: join(output, 'images/display.png'),
    outputDirectory: output,
    image,
    imageArtifacts,
    taskId: randomUUID()
  })
)
const child = spawn(
  pythonPath,
  ['-u', join(root, 'backend/rita/worker.py'), '--request', requestFile],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  }
)
const timeout = setTimeout(() => {
  console.error('RITA timeout; terminating worker.')
  child.kill()
}, config.timeoutMs ?? 180000)
const stop = () => child.kill()
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
child.once('error', (error) => {
  console.error(error.message)
  process.exitCode = 1
})
child.once('close', (code) => {
  clearTimeout(timeout)
  process.removeListener('SIGINT', stop)
  process.removeListener('SIGTERM', stop)
  process.exitCode = code ?? 1
  console.log(`Run directory: ${output}`)
})
