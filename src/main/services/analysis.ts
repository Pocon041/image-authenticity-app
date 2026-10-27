import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { AnalysisProgress, AnalysisReport } from '../../shared/contracts'
import type { ImportedImage } from '../image-import'

// Future local inference implementations must preserve this boundary.
export interface AnalysisService {
  analyze(input: ImportedImage, context: AnalysisContext): Promise<AnalysisReport>
}

export interface AnalysisContext {
  taskId: string
  signal: AbortSignal
  onProgress(progress: AnalysisProgress): void
}

export class MockAnalysisService implements AnalysisService {
  async analyze(input: ImportedImage, context: AnalysisContext): Promise<AnalysisReport> {
    const image = input.asset
    const startedAt = performance.now()
    const stages = [
      { stage: 'preparing', percent: 15, label: '准备图像信息' },
      { stage: 'analyzing', percent: 50, label: '运行模拟分析' },
      { stage: 'describing', percent: 85, label: '生成模板描述' }
    ] as const
    for (const stage of stages) {
      context.signal.throwIfAborted()
      context.onProgress({ ...stage, taskId: context.taskId, imageId: image.id })
      await delay(500, undefined, { signal: context.signal })
    }
    return {
      id: randomUUID(),
      imageId: image.id,
      mode: 'mock',
      createdAt: new Date().toISOString(),
      elapsedMs: Math.round(performance.now() - startedAt),
      title: '模拟分析已完成',
      summary: `已接收图片「${image.name}」，分辨率为 ${image.width} × ${image.height}。这是一段预置的模拟分析描述，用于验证图片导入、分析调用与结果展示的完整流程。`,
      sections: [
        {
          title: 'AI 生成检测',
          description: '演示分支已完成。本阶段没有运行检测模型，尚未对图片是否由 AI 生成作出判断。'
        },
        {
          title: '局部篡改定位',
          description: '演示分支已完成。本阶段不生成篡改热图、区域标注或定位结果。'
        },
        {
          title: '自然语言描述',
          description:
            '本段内容由本地固定模板生成，没有调用语言模型。真实检测结果与证据解释将在后续阶段接入。'
        }
      ],
      disclaimer: '模拟结果 · 未运行任何检测或语言模型，不构成图像真实性判断。'
    }
  }
}
