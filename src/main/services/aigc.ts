// [第三人任务] FSD 本地 AIGC 适配器。需显式准备 FSD Python 环境及权重。
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { app } from 'electron'
import sharp from 'sharp'
import type { AnalysisReport } from '../../shared/contracts'
import { AppError } from '../errors'
import type { ImportedImage } from '../image-import'
import type { AnalysisContext, AnalysisService } from './analysis'
import { runPythonWorker } from './python-worker'

interface Config { pythonPath: string; sourcePath: string; device: 'auto' | 'cpu' | 'cuda'; threshold: number; attribution: boolean; timeoutMs: number }
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')

export class AigcAnalysisService implements AnalysisService {
  async analyze(input: ImportedImage, context: AnalysisContext): Promise<AnalysisReport> {
    if (app.isPackaged) throw new AppError('MODEL_NOT_READY', 'FSD 尚未配置发布包运行环境。')
    const root = app.getAppPath()
    let config: Config
    try { config = JSON.parse((await readFile(join(root, 'config/aigc.local.json'), 'utf8')).replace(/^\uFEFF/, '')) }
    catch { throw new AppError('MODEL_NOT_READY', '请复制 config/aigc.example.json 为 config/aigc.local.json 并配置 FSD 环境。') }
    if (typeof config.pythonPath !== 'string' || typeof config.sourcePath !== 'string' || !['auto','cpu','cuda'].includes(config.device) || !Number.isFinite(config.threshold) || !Number.isFinite(config.timeoutMs) || typeof config.attribution !== 'boolean') throw new AppError('INVALID_REQUEST', 'FSD 配置无效。')
    const pythonPath = config.pythonPath.includes('/') || config.pythonPath.includes('\\') ? resolve(root, config.pythonPath) : config.pythonPath
    const sourcePath = resolve(root, config.sourcePath)
    try { await access(join(sourcePath, 'fsd', '__init__.py')) } catch { throw new AppError('MODEL_NOT_READY', '找不到固定版本 FSD 源码。') }
    const output = join(root, 'work/aigc-runs', context.taskId)
    // [第三人任务] 首次下载 FSD 权重耗时可能超过普通单图推理，给下载留出 15 分钟。
    const timeoutMs = Math.max(config.timeoutMs, 900000)
    await mkdir(output, { recursive: true })
    // [第三人任务] 为 FSD 保留原始图像输入与 EXIF 校正后的规范显示图。
    const imageDir = join(output, 'images')
    await mkdir(imageDir, { recursive: true })
    const displayBytes = await sharp(input.originalBytes, { limitInputPixels: 60_000_000 }).rotate().png().toBuffer()
    const displayPath = join(imageDir, 'display.png')
    await writeFile(displayPath, displayBytes)
    const image = {
      imageId: input.asset.id, sha256: input.asset.sha256,
      originalArtifactId: `${input.asset.id}:original`, displayArtifactId: `${input.asset.id}:display`,
      encodedWidth: input.asset.width, encodedHeight: input.asset.height,
      width: input.asset.width, height: input.asset.height, exifOrientation: 1,
      coordinateSpace: 'display_image_pixels', displayTransform: 'exif_auto_orient_no_resize'
    }
    const artifacts = [
      { artifactId: image.originalArtifactId, type: 'original', uri: 'images/original', mediaType: input.asset.mimeType, sha256: input.asset.sha256, width: image.width, height: image.height, coordinateSpace: 'encoded_file_pixels', bboxXYWH: null, sourceArtifactId: null, origin: 'original' },
      { artifactId: image.displayArtifactId, type: 'display', uri: 'images/display.png', mediaType: 'image/png', sha256: sha256(displayBytes), width: image.width, height: image.height, coordinateSpace: 'display_image_pixels', bboxXYWH: null, sourceArtifactId: image.originalArtifactId, origin: 'derived' }
    ]
    await writeFile(join(output, 'images/original'), input.originalBytes)
    const requestPath = join(output, 'request.json')
    await writeFile(requestPath, JSON.stringify({ image, artifacts, imagePath: displayPath, sourcePath: input.sourcePath, fsdSourcePath: sourcePath, outputDirectory: output, device: config.device, threshold: config.threshold, attribution: config.attribution, taskId: context.taskId }))
    context.onProgress({ taskId: context.taskId, imageId: input.asset.id, stage: 'analyzing', percent: 2, label: '正在检查并加载 FSD 权重（首次运行会联网下载）' })
    await runPythonWorker({ pythonPath, workerPath: join(root, 'backend/aigc/worker.py'), requestPath, cwd: root, timeoutMs, name: 'FSD', imageId: input.asset.id, context })
    const bundle = JSON.parse(await readFile(join(output, 'bundle.json'), 'utf8'))
    const report = bundle.reports?.[0]
    if (!report || bundle.image?.imageId !== input.asset.id || report.mode !== 'local' || report.moduleId !== 'aigc') throw new AppError('INFERENCE_FAILED', 'FSD 输出身份或协议无效。')
    const result = report.result
    return { id: context.taskId, imageId: input.asset.id, backend: 'aigc', mode: 'local', createdAt: report.createdAt, elapsedMs: report.elapsedMs, title: 'FSD AI 生成检测已完成', summary: `${basename(input.sourcePath)}：${result.decision === 'ai_generated' ? '检测倾向 AI 生成' : result.decision === 'non_ai' ? '检测倾向真实图像' : '结果不确定'}。`, sections: [], disclaimer: (report.limitations ?? []).join(' '), aigc: { decision: result.decision, zScore: result.score.value, threshold: result.threshold, attributedSource: result.attribution?.source ?? null, attributionScore: result.attribution?.score ?? null, bundlePath: join(output, 'bundle.json'), bundle } }
  }
}
