import type { AnalysisProgress } from '../../shared/contracts'
import { AppError } from '../errors'
import type { ImportedImage } from '../image-import'
import type { AnalysisService } from './analysis'

export class AnalysisSession {
  private selectedImage: ImportedImage | null = null
  private activeTask: { taskId: string; controller: AbortController } | null = null

  constructor(private readonly service: AnalysisService) {}

  get busy(): boolean {
    return this.activeTask !== null
  }

  selectImage(image: ImportedImage): void {
    this.assertIdle()
    this.selectedImage = image
  }

  clearImage(): void {
    this.assertIdle()
    this.selectedImage = null
  }

  private assertIdle(): void {
    if (this.busy) throw new AppError('BUSY', '已有分析任务正在运行。')
  }

  async analyze(imageId: string, taskId: string, onProgress: (progress: AnalysisProgress) => void) {
    this.assertIdle()
    if (!this.selectedImage || this.selectedImage.asset.id !== imageId) {
      throw new AppError('STALE_IMAGE', '图片已失效，请重新选择图片。')
    }
    const task = { taskId, controller: new AbortController() }
    this.activeTask = task
    try {
      return await this.service.analyze(this.selectedImage, {
        taskId,
        signal: task.controller.signal,
        onProgress
      })
    } catch (error) {
      if (task.controller.signal.aborted) throw new AppError('CANCELLED', '模拟分析已取消。')
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
