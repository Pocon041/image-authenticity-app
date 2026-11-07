import type {
  AnalysisBackend,
  AnalysisProgress,
  AnalysisReport,
  WorkflowOptions
} from '../../shared/contracts'
import { AppError } from '../errors'
import type { ImportedImage } from '../image-import'
import type { AnalysisService } from './analysis'
import type { ExplanationReport } from '../../shared/protocol'

export class AnalysisSession {
  private selectedImage: ImportedImage | null = null
  private activeTask: { taskId: string; controller: AbortController } | null = null
  private previousReport: AnalysisReport | null = null
  private explanationTask: {
    taskId: string
    controller: AbortController
    promise: Promise<ExplanationReport>
  } | null = null

  constructor(
    private readonly service: AnalysisService,
    private readonly beforeAnalyze?: () => Promise<void>
  ) {}

  get busy(): boolean {
    return this.activeTask !== null
  }

  reportForTask(taskId: string): AnalysisReport {
    if (!this.previousReport?.workflow || this.previousReport.id !== taskId)
      throw new AppError('INVALID_REQUEST', '报告已失效，请重新分析。')
    return this.previousReport
  }

  selectImage(image: ImportedImage): void {
    this.assertIdle()
    this.cancelExplanation()
    this.selectedImage = image
    this.previousReport = null
  }

  clearImage(): void {
    this.assertIdle()
    this.cancelExplanation()
    this.selectedImage = null
    this.previousReport = null
  }

  private assertIdle(): void {
    if (this.busy) throw new AppError('BUSY', '已有分析任务正在运行。')
  }

  async analyze(
    imageId: string,
    taskId: string,
    onProgress: (progress: AnalysisProgress) => void,
    backend: AnalysisBackend = 'mock',
    workflowOptions?: WorkflowOptions
  ) {
    this.assertIdle()
    if (!this.selectedImage || this.selectedImage.asset.id !== imageId) {
      throw new AppError('STALE_IMAGE', '图片已失效，请重新选择图片。')
    }
    if (
      workflowOptions?.supplementFromTaskId &&
      (backend !== 'workflow' ||
        !this.previousReport?.workflow ||
        this.previousReport.id !== workflowOptions.supplementFromTaskId ||
        this.previousReport.imageId !== imageId ||
        (workflowOptions.contentType !== 'auto' &&
          this.previousReport.workflow.contentType !== workflowOptions.contentType))
    )
      throw new AppError('STALE_IMAGE', '补充分析的报告已失效，请重新开始分析。')
    const task = { taskId, controller: new AbortController() }
    this.activeTask = task
    try {
      // A previous explanation may still own the GPU after its UI was closed.
      const previousExplanation = this.explanationTask
      if (previousExplanation) {
        previousExplanation.controller.abort()
        await previousExplanation.promise.catch(() => {})
      }
      task.controller.signal.throwIfAborted()
      await this.beforeAnalyze?.()
      task.controller.signal.throwIfAborted()
      const report = await this.service.analyze(this.selectedImage, {
        backend,
        taskId,
        signal: task.controller.signal,
        onProgress,
        workflowOptions,
        previousReport: workflowOptions?.supplementFromTaskId
          ? (this.previousReport ?? undefined)
          : undefined
      })
      this.previousReport = report
      return report
    } catch (error) {
      if (task.controller.signal.aborted) throw new AppError('CANCELLED', '分析任务已取消。')
      throw error
    } finally {
      if (this.activeTask === task) this.activeTask = null
    }
  }

  cancel(taskId: string): boolean {
    if (!this.activeTask || this.activeTask.taskId !== taskId) return this.cancelExplanation(taskId)
    this.activeTask.controller.abort()
    return true
  }

  dispose(): void {
    this.activeTask?.controller.abort()
    this.cancelExplanation()
    this.selectedImage = null
  }

  explain(
    taskId: string,
    generate: (report: AnalysisReport, signal: AbortSignal) => Promise<ExplanationReport>
  ): Promise<ExplanationReport> {
    this.assertIdle()
    const report = this.reportForTask(taskId)
    if (report.explanation?.mode === 'local') return Promise.resolve(report.explanation)
    if (this.explanationTask?.taskId === taskId) return this.explanationTask.promise
    const task = {
      taskId,
      controller: new AbortController(),
      promise: undefined as unknown as Promise<ExplanationReport>
    }
    task.promise = Promise.resolve()
      .then(() => generate(report, task.controller.signal))
      .then((explanation) => {
        if (task.controller.signal.aborted) throw new AppError('CANCELLED', '已停止生成说明。')
        if (this.previousReport === report) report.explanation = explanation
        return explanation
      })
      .finally(() => {
        if (this.explanationTask === task) this.explanationTask = null
      })
    this.explanationTask = task
    return task.promise
  }

  private cancelExplanation(taskId?: string): boolean {
    if (!this.explanationTask || (taskId && this.explanationTask.taskId !== taskId)) return false
    this.explanationTask.controller.abort()
    return true
  }
}
