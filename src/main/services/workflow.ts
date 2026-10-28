import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AnalysisReport,
  DetectorBackend,
  DetectorResult,
  WorkflowStep
} from '../../shared/contracts'
import { AppError } from '../errors'
import type { ImportedImage } from '../image-import'
import type { AnalysisContext, AnalysisService } from './analysis'
import { aggregateEvidence, prepareWorkflowInput } from './evidence-bundle'
import { detectorNames, plannedDetectors, workflowFlags } from './workflow-policy'

export class WorkflowAnalysisService implements AnalysisService {
  constructor(
    private readonly root: string,
    private readonly services: Record<DetectorBackend, AnalysisService>
  ) {}

  async analyze(input: ImportedImage, context: AnalysisContext): Promise<AnalysisReport> {
    const started = performance.now()
    const options = context.workflowOptions
    if (!options || !['photo', 'document', 'unsure'].includes(options.contentType))
      throw new AppError('INVALID_REQUEST', '图片类型无效。')
    const previous = context.previousReport?.workflow
    const planned = plannedDetectors(options.contentType, !!previous)
    const output = join(this.root, 'work/analysis-runs', context.taskId)
    await mkdir(join(this.root, 'work/analysis-runs'), { recursive: true })
    try {
      await mkdir(output)
    } catch {
      throw new AppError('INVALID_REQUEST', '任务ID已使用，请重新开始。')
    }
    const detectors: DetectorResult[] = []
    const steps: WorkflowStep[] = planned.map((backend) => ({ backend, status: 'pending' }))
    const notify = (percent: number, label: string) =>
      context.onProgress({
        taskId: context.taskId,
        imageId: input.asset.id,
        stage: 'analyzing',
        percent,
        label,
        steps: steps.map((step) => ({ ...step }))
      })
    const manifest = async (status: string) =>
      writeFile(
        join(output, 'run.json'),
        JSON.stringify(
          {
            taskId: context.taskId,
            imageId: input.asset.id,
            contentType: options.contentType,
            previousTaskId: options.supplementFromTaskId ?? null,
            status,
            steps
          },
          null,
          2
        )
      )
    try {
      context.signal.throwIfAborted()
      notify(1, '检查来源信息与图像预处理')
      const common = await prepareWorkflowInput(input, output, this.root, context.signal)
      await manifest('running')
      for (let index = 0; index < planned.length; index++) {
        context.signal.throwIfAborted()
        const backend = planned[index]
        const cached = previous?.detectors.find(
          (d) => d.backend === backend && d.status === 'completed'
        )
        if (cached) {
          detectors.push({ ...structuredClone(cached), reused: true })
          steps[index].status = 'reused'
          notify(
            5 + Math.round((85 * (index + 1)) / planned.length),
            `复用 ${detectorNames[backend]} 已完成证据`
          )
          continue
        }
        steps[index].status = 'running'
        notify(5 + Math.round((85 * index) / planned.length), `准备 ${detectorNames[backend]}`)
        const phaseStarted = performance.now()
        try {
          const result = await this.services[backend].analyze(input, {
            ...context,
            backend,
            workflowOptions: undefined,
            previousReport: undefined,
            taskId: `${context.taskId}-${backend}`,
            onProgress: (progress) =>
              notify(
                Math.min(
                  90,
                  5 + Math.round((85 * (index + progress.percent / 100)) / planned.length)
                ),
                `${detectorNames[backend]} · ${progress.label}`
              )
          })
          context.signal.throwIfAborted()
          if (
            result.mode !== 'local' ||
            result.imageId !== input.asset.id ||
            (backend === 'sica' ? !result.classification : !result.localization)
          )
            throw new AppError('INFERENCE_FAILED', '检测器返回了不完整或非真实报告。')
          detectors.push({
            backend,
            status: 'completed',
            elapsedMs: Math.round(performance.now() - phaseStarted),
            ...(result.classification ? { classification: result.classification } : {}),
            ...(result.localization ? { localization: result.localization } : {})
          })
          steps[index].status = 'completed'
        } catch (error) {
          if (context.signal.aborted) throw error
          detectors.push({
            backend,
            status: 'failed',
            elapsedMs: Math.round(performance.now() - phaseStarted),
            error: {
              code: error instanceof AppError ? error.code : 'INFERENCE_FAILED',
              message: error instanceof Error ? error.message : '检测未完成。'
            }
          })
          steps[index].status = 'failed'
        }
        await manifest('running')
      }
      for (const backend of ['sica', 'rita', 'rise'] as const)
        if (!planned.includes(backend)) detectors.push({ backend, status: 'not_run', elapsedMs: 0 })
      const flags = workflowFlags(detectors)
      notify(94, '整理可追溯证据与附件')
      const merged = await aggregateEvidence({
        root: this.root,
        output,
        taskId: context.taskId,
        contentType: options.contentType,
        detectors,
        common,
        elapsedMs: Math.round(performance.now() - started),
        flags,
        signal: context.signal,
        previousTaskId: options.supplementFromTaskId
      })
      await manifest(merged.status)
      context.signal.throwIfAborted()
      const hasRegions = detectors.some((d) => (d.localization?.regionCount ?? 0) > 0)
      const title =
        merged.status === 'failed'
          ? '检测未完成'
          : hasRegions
            ? '已标记可疑区域'
            : '本轮未定位到可疑区域'
      notify(
        100,
        merged.status === 'completed' ? '分析完成，证据包已保存' : '已保存检测状态与可用证据'
      )
      return {
        id: context.taskId,
        imageId: input.asset.id,
        backend: 'workflow',
        mode: 'local',
        createdAt: new Date().toISOString(),
        elapsedMs: Math.round(performance.now() - started),
        title,
        summary:
          merged.status === 'failed'
            ? '计划的检测均未完成，请查看各项错误并检查模型配置。'
            : hasRegions
              ? '定位结果已保留。请结合整图筛查、区域来源和模型分歧查看，标记区域不等于已证实篡改。'
              : '已完成的定位器未标记区域。请查看整图筛查结果及未完成项目；未检出不等于确认真实。',
        sections: [],
        disclaimer: '当前输出为视觉检测证据，整图真实性尚无经校准的融合结论。',
        workflow: {
          contentType: options.contentType,
          primary:
            options.contentType === 'photo'
              ? 'rita'
              : options.contentType === 'document'
                ? 'rise'
                : null,
          status: merged.status,
          detectors,
          flags,
          bundlePath: join(output, 'bundle.json'),
          bundle: merged.bundle,
          summaryPath: join(output, 'analysis.json'),
          summary: merged.summary,
          previousTaskId: options.supplementFromTaskId
        }
      }
    } catch (error) {
      if (context.signal.aborted)
        for (const step of steps) {
          if (step.status === 'running') step.status = 'cancelled'
          else if (step.status === 'pending') step.status = 'not_run'
        }
      for (const name of ['bundle.json', 'report.json', 'analysis.json'])
        await rm(join(output, name), { force: true })
      await rm(join(output, 'reports/provenance.json'), { force: true })
      await manifest(context.signal.aborted ? 'cancelled' : 'failed')
      throw error
    }
  }
}
