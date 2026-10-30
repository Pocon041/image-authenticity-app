import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { dirname, resolve } from 'node:path'
import { IPC, type Response, type ImageAsset, type WorkflowOptions } from '../shared/contracts'
import { AppError, failure } from './errors'
import { importImage } from './image-import'
import type { AnalysisSession } from './services/analysis-session'
import { generateExplanation } from './services/explanation'
import type { EvidenceBundle, ExplanationReport } from '../shared/protocol'


export function registerDesktopIPC(
  getWindow: () => BrowserWindow | null,
  session: AnalysisSession
): void {
  let picking = false

  function requireWindow(event: IpcMainInvokeEvent): BrowserWindow {
    const window = getWindow()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    ) {
      throw new AppError('UNTRUSTED', '请求来源无效。')
    }
    return window
  }

  function validateId(value: unknown, image = false): asserts value is string {
    if (typeof value !== 'string' || !(image ? /^[\w:-]{1,100}$/ : /^[\w-]{1,80}$/).test(value)) {
      throw new AppError('INVALID_REQUEST', '请求参数无效。')
    }
  }

  ipcMain.handle(IPC.chooseImage, async (event): Promise<Response<ImageAsset | null>> => {
    try {
      const window = requireWindow(event)
      if (session.busy || picking) throw new AppError('BUSY', '请等待当前操作结束。')
      picking = true
      try {
        const result = await dialog.showOpenDialog(window, {
          title: '选择待分析图片',
          properties: ['openFile'],
          filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
        })
        if (result.canceled || !result.filePaths[0]) return { ok: true, data: null }
        const image = await importImage(result.filePaths[0])
        session.selectImage(image)
        return { ok: true, data: image.asset }
      } finally {
        picking = false
      }
    } catch (error) {
      return failure(error, 'INVALID_IMAGE')
    }
  })

  ipcMain.handle(IPC.clearImage, (event): Response<null> => {
    try {
      requireWindow(event)
      if (picking) throw new AppError('BUSY', '请等待当前操作结束。')
      session.clearImage()
      return { ok: true, data: null }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(
    IPC.analyze,
    async (
      event,
      imageId: unknown,
      taskId: unknown,
      backend: unknown = 'mock',
      options?: unknown
    ) => {
      try {
        const window = requireWindow(event)
        validateId(imageId, true)
        validateId(taskId)
        if (
          backend !== 'mock' &&
          backend !== 'rita' &&
          backend !== 'sica' &&
          backend !== 'rise' &&
          backend !== 'aigc' &&
          backend !== 'workflow'
        )
          throw new AppError('INVALID_REQUEST', '未知的分析服务。')
        let workflowOptions: WorkflowOptions | undefined
        if (backend === 'workflow') {
          if (!options || typeof options !== 'object' || Array.isArray(options))
            throw new AppError('INVALID_REQUEST', '请选择图片内容类型。')
          const value = options as Record<string, unknown>
          if (
            typeof value.contentType !== 'string' ||
            !['photo', 'document', 'unsure'].includes(value.contentType) ||
            Object.keys(value).some((key) => !['contentType', 'supplementFromTaskId'].includes(key))
          )
            throw new AppError('INVALID_REQUEST', '联合分析参数无效。')
          if (value.supplementFromTaskId !== undefined) validateId(value.supplementFromTaskId)
          workflowOptions = value as unknown as WorkflowOptions
        }
        if (picking) throw new AppError('BUSY', '请等待图片导入结束。')
        const report = await session.analyze(
          imageId,
          taskId,
          (progress) => {
            if (!window.isDestroyed()) window.webContents.send(IPC.progress, progress)
          },
          backend,
          workflowOptions
        )
        return { ok: true, data: report }
      } catch (error) {
        return failure(error)
      }
    }
  )

  ipcMain.handle(IPC.cancelAnalysis, (event, taskId: unknown): Response<boolean> => {
    try {
      requireWindow(event)
      validateId(taskId)
      return { ok: true, data: session.cancel(taskId) }
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(
    IPC.openReportDirectory,
    async (event, taskId: unknown): Promise<Response<null>> => {
      try {
        requireWindow(event)
        validateId(taskId)
        const report = session.reportForTask(taskId)
        const directory = dirname(report.workflow!.bundlePath)
        if (resolve(directory) !== resolve(app.getAppPath(), 'work/analysis-runs', taskId))
          throw new AppError('INVALID_REQUEST', '报告目录无效。')
        const error = await shell.openPath(directory)
        if (error) throw new AppError('INTERNAL', '无法打开报告文件夹，请查看报告保存路径。')
        return { ok: true, data: null }
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle(
    IPC.explain,
    async (event, taskId: unknown): Promise<Response<ExplanationReport>> => {
      try {
        requireWindow(event)
        validateId(taskId)

        // 从当前会话获取历史分析报告
        const report = session.reportForTask(taskId as string)
        if (!report || !report.workflow?.bundle) {
          throw new AppError('INVALID_REQUEST', '未找到该任务的证据包，请先完成联合分析。')
        }

        // 提取并断言为 EvidenceBundle
        const bundle = report.workflow.bundle as unknown as EvidenceBundle

        // 调用解释生成服务（内部已包含 Ollama 调用与模板兜底）
        const explanation = await generateExplanation(bundle, taskId as string)
        
        return { ok: true, data: explanation }
      } catch (error) {
        return failure(error)
      }
    }
  )  
}
