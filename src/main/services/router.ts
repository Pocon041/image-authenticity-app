import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { WorkflowRouting } from '../../shared/contracts'
import { AppError } from '../errors'
import type { AnalysisContext } from './analysis'
import { runPythonWorker } from './python-worker'
import type { Artifact, ImageInfo } from '../../shared/protocol'

interface RouterConfig {
  pythonPath: string
  clipSourcePath: string
  checkpointPath: string
  checkpointSha256: string | null
  checkpointVariant: 'train' | 'full' | 'unknown'
  device: 'auto' | 'cpu' | 'cuda'
  marginThreshold: number
  timeoutMs: number
}

interface RouterJson {
  schemaVersion: string
  taskId: string
  imageId: string
  mode: string
  status: string
  decision: string
  scores: { photo: number; document: number }
  margin: number
  marginThreshold: number
  elapsedMs: number
}

// 预处理后的零样本 CLIP 内容路由。只决定检测器组合，不产生篡改结论。
export async function routeContentType(args: {
  root: string
  output: string
  taskId: string
  artifacts: Artifact[]
  image: ImageInfo
  context: AnalysisContext
}): Promise<WorkflowRouting> {
  const { root, output, taskId, artifacts, image, context } = args
  // Lazy electron import keeps workflow.ts bundleable for the synthetic unit tests.
  let packaged = false
  try {
    const { app } = await import('electron')
    packaged = app.isPackaged
  } catch {
    /* running outside Electron (unit tests) */
  }
  if (packaged)
    throw new AppError('MODEL_NOT_READY', '内容路由暂在源码开发模式接入，发布包环境尚未配置。')
  const file = resolve(root, process.env.SRDP_ROUTER_CONFIG ?? 'config/router.local.json')
  let config: RouterConfig
  try {
    config = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
  } catch {
    throw new AppError(
      'MODEL_NOT_READY',
      '请复制 config/router.example.json 为 config/router.local.json 并配置 Python 与权重。'
    )
  }
  for (const key of ['pythonPath', 'clipSourcePath', 'checkpointPath'] as const)
    if (typeof config[key] !== 'string' || !config[key])
      throw new AppError('INVALID_REQUEST', `内容路由配置缺少 ${key}。`)
  if (
    !Number.isFinite(config.marginThreshold) ||
    config.marginThreshold <= 0 ||
    config.marginThreshold >= 1 ||
    !Number.isFinite(config.timeoutMs) ||
    config.timeoutMs < 1000 ||
    config.timeoutMs > 600000 ||
    !['auto', 'cpu', 'cuda'].includes(config.device) ||
    !['train', 'full', 'unknown'].includes(config.checkpointVariant)
  )
    throw new AppError('INVALID_REQUEST', '内容路由阈值、设备、权重类型或超时配置无效。')
  if (config.checkpointSha256 !== null && !/^[a-f0-9]{64}$/.test(config.checkpointSha256))
    throw new AppError('INVALID_REQUEST', '内容路由权重哈希应为完整小写 SHA256 或 null。')
  config = {
    ...config,
    clipSourcePath: resolve(root, config.clipSourcePath),
    checkpointPath: resolve(root, config.checkpointPath),
    pythonPath:
      config.pythonPath.includes('/') || config.pythonPath.includes('\\')
        ? resolve(root, config.pythonPath)
        : config.pythonPath
  }
  try {
    await access(config.checkpointPath)
    await access(join(config.clipSourcePath, 'srdp-source-manifest.json'))
  } catch {
    throw new AppError(
      'MODEL_NOT_READY',
      '缺少内容路由权重或固定版本 CLIP 源码，请运行 npm.cmd run sica:setup 并检查配置。'
    )
  }
  const originalArtifact = artifacts.find((item) => item.type === 'original')
  if (!originalArtifact)
    throw new AppError('INVALID_IMAGE', '预处理阶段缺少原始图片附件。')
  const routerOutput = join(output, 'router')
  await mkdir(routerOutput, { recursive: true })
  const requestPath = join(routerOutput, 'request.local.json')
  await writeFile(
    requestPath,
    JSON.stringify({
      ...config,
      originalPath: join(output, originalArtifact.uri),
      displayPath: join(output, 'images/display.png'),
      outputDirectory: routerOutput,
      taskId,
      image: {
        imageId: image.imageId,
        sha256: image.sha256,
        originalArtifactId: image.originalArtifactId,
        displayArtifactId: image.displayArtifactId,
        width: image.width,
        height: image.height
      }
    })
  )
  context.signal.throwIfAborted()
  await runPythonWorker({
    pythonPath: config.pythonPath,
    workerPath: join(root, 'backend/router/worker.py'),
    requestPath,
    cwd: root,
    timeoutMs: config.timeoutMs,
    name: '内容路由',
    imageId: image.imageId,
    context
  })
  context.signal.throwIfAborted()
  const routingPath = join(routerOutput, 'routing.json')
  let raw: RouterJson
  try {
    raw = JSON.parse(await readFile(routingPath, 'utf8')) as RouterJson
  } catch {
    throw new AppError('INFERENCE_FAILED', '内容路由未生成有效结果文件。')
  }
  const finiteUnit = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  if (
    raw.schemaVersion !== '1.0' ||
    raw.taskId !== taskId ||
    raw.imageId !== image.imageId ||
    raw.mode !== 'local' ||
    raw.status !== 'completed' ||
    !['photo', 'document', 'unsure'].includes(raw.decision) ||
    !raw.scores ||
    !finiteUnit(raw.scores.photo) ||
    !finiteUnit(raw.scores.document) ||
    !Number.isFinite(raw.margin) ||
    raw.margin < 0 ||
    !Number.isFinite(raw.marginThreshold) ||
    !Number.isFinite(raw.elapsedMs)
  )
    throw new AppError('INFERENCE_FAILED', '内容路由输出身份或字段无效。')
  return {
    mode: 'auto',
    status: 'completed',
    decision: raw.decision as WorkflowRouting['decision'],
    scores: { photo: raw.scores.photo, document: raw.scores.document },
    margin: raw.margin,
    marginThreshold: raw.marginThreshold,
    elapsedMs: raw.elapsedMs
  }
}
