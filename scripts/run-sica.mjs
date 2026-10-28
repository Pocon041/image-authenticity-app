import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
if (!option('--image'))
  throw new Error(
    'Usage: npm.cmd run sica:infer -- --image <path> [--output <directory>] [--config <config>]'
  )
const config = JSON.parse(
  (await readFile(resolve(root, option('--config', 'config/sica.local.json')), 'utf8')).replace(
    /^\uFEFF/,
    ''
  )
)
const bytes = await readFile(resolve(option('--image')))
const digest = (data) => createHash('sha256').update(data).digest('hex')
const hash = digest(bytes)
const metadata = await sharp(bytes, { limitInputPixels: 60000000 }).metadata()
if (!['jpeg', 'png', 'webp'].includes(metadata.format))
  throw new Error('Only JPEG/PNG/WebP are supported')
const output = resolve(root, option('--output', `work/sica-cli/${randomUUID()}`))
await mkdir(join(output, 'images'), { recursive: true })
const originalUri = `images/original.${metadata.format === 'jpeg' ? 'jpg' : metadata.format}`
const display = await sharp(bytes).rotate().toColourspace('srgb').png().toBuffer()
const info = await sharp(display).metadata()
await writeFile(join(output, originalUri), bytes)
await writeFile(join(output, 'images/display.png'), display)
const image = {
  imageId: `sha256:${hash}`,
  sha256: hash,
  originalArtifactId: `${hash}:original`,
  displayArtifactId: `${hash}:display`,
  encodedWidth: metadata.width,
  encodedHeight: metadata.height,
  width: info.width,
  height: info.height,
  exifOrientation: metadata.orientation ?? 1,
  coordinateSpace: 'display_image_pixels',
  displayTransform: 'exif_auto_orient_no_resize'
}
const imageArtifacts = [
  {
    artifactId: image.originalArtifactId,
    type: 'original',
    uri: originalUri,
    mediaType: `image/${metadata.format}`,
    sha256: hash,
    width: metadata.width,
    height: metadata.height,
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
    sha256: digest(display),
    width: image.width,
    height: image.height,
    coordinateSpace: 'display_image_pixels',
    bboxXYWH: null,
    sourceArtifactId: image.originalArtifactId,
    origin: 'derived'
  }
]
const request = join(output, 'request.local.json')
const python =
  config.pythonPath.includes('/') || config.pythonPath.includes('\\')
    ? resolve(root, config.pythonPath)
    : config.pythonPath
await writeFile(
  request,
  JSON.stringify({
    ...config,
    upstreamPath: resolve(root, config.upstreamPath),
    clipSourcePath: resolve(root, config.clipSourcePath),
    checkpointPath: resolve(root, config.checkpointPath),
    originalPath: join(output, originalUri),
    displayPath: join(output, 'images/display.png'),
    outputDirectory: output,
    taskId: randomUUID(),
    image,
    imageArtifacts
  })
)
const child = spawn(python, ['-u', join(root, 'backend/sica/worker.py'), '--request', request], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
})
const timeout = setTimeout(() => {
  console.error('SICA timeout')
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
