import type {
  AnalysisBackend,
  AnalysisProgress,
  AnalysisReport,
  WorkflowOptions
} from '../../shared/contracts'
import { AppError } from '../errors'
import type { ImportedImage } from '../image-import'
import type { AnalysisService } from './analysis'

export class AnalysisSession {
  private selectedImage: ImportedImage | null = null
  private activeTask: { taskId: string; controller: AbortController } | null = null
  private previousReport: AnalysisReport | null = null

  constructor(private readonly service: AnalysisService) {}

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
    this.selectedImage = image
    this.previousReport = null
  }

  clearImage(): void {
    this.assertIdle()
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
        this.previousReport.workflow.contentType !== workflowOptions.contentType)
    )
      throw new AppError('STALE_IMAGE', '补充分析的报告已失效，请重新开始分析。')
    const task = { taskId, controller: new AbortController() }
    this.activeTask = task
    try {
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
    if (!this.activeTask || this.activeTask.taskId !== taskId) return false
    this.activeTask.controller.abort()
    return true
  }

  dispose(): void {
    this.activeTask?.controller.abort()
    this.selectedImage = null
  }
}
