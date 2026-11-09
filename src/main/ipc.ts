import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { dirname, resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { IPC, type Response, type ImageAsset, type WorkflowOptions } from '../shared/contracts'
import { AppError, failure } from './errors'
import { importImage } from './image-import'
import type { AnalysisSession } from './services/analysis-session'
import { generateExplanation } from './services/explanation'
import type { EvidenceBundle, ExplanationReport } from '../shared/protocol'
import { getRuntimeRoot } from './runtime-paths'
import { requireRuntimeEnvironment, runtimeEnvironment, selectRuntimeDirectory } from './runtime-environment'

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

  ipcMain.handle(IPC.runtimeEnvironment, async event => {
    try {
      requireWindow(event)
      return { ok: true, data: await runtimeEnvironment() }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC.chooseRuntimeDirectory, async event => {
    try {
      const window = requireWindow(event)
      if (session.busy || picking) throw new AppError('BUSY', '请等待当前操作结束。')
      picking = true
      try {
        const chosen = await dialog.showOpenDialog(window, {
          title: '选择模型与报告目录，可选择已配置好的项目目录',
          properties: ['openDirectory', 'createDirectory']
        })
        if (chosen.canceled || !chosen.filePaths[0]) return { ok: true, data: null }
        const data = await selectRuntimeDirectory(chosen.filePaths[0], () => session.clearImage())
        return { ok: true, data }
      } finally {
        picking = false
      }
    } catch (error) {
      return failure(error)
    }
  })

  ipcMain.handle(IPC.openRuntimeDirectory, async event => {
    try {
      requireWindow(event)
      const info = await runtimeEnvironment()
      if (!info.directory) throw new AppError('MODEL_NOT_READY', '请先选择模型与报告目录。')
      const error = await shell.openPath(info.directory)
      if (error) throw new AppError('INTERNAL', '无法打开模型与报告目录。')
      return { ok: true, data: null }
    } catch (error) {
      return failure(error)
    }
  })

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
            !['photo', 'document', 'unsure', 'auto'].includes(value.contentType) ||
            Object.keys(value).some((key) => !['contentType', 'supplementFromTaskId'].includes(key))
          )
            throw new AppError('INVALID_REQUEST', '联合分析参数无效。')
          if (value.supplementFromTaskId !== undefined) validateId(value.supplementFromTaskId)
          workflowOptions = value as unknown as WorkflowOptions
        }
        if (picking) throw new AppError('BUSY', '请等待图片导入结束。')
        if (backend !== 'mock') requireRuntimeEnvironment()
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
        if (resolve(directory) !== resolve(getRuntimeRoot(app.getAppPath()), 'work/analysis-runs', taskId))
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
        const window = requireWindow(event)
        validateId(taskId)

        if (picking) throw new AppError('BUSY', '请等待目录或图片选择结束。')
        const explanation = await session.explain(taskId, async (report, signal) => {
          const bundle = report.workflow!.bundle as unknown as EvidenceBundle
          const result = await generateExplanation(bundle, taskId, undefined, undefined, {
            signal,
            releaseModel: true,
            onProgress(progress) {
              if (!window.isDestroyed())
                window.webContents.send(IPC.explanationProgress, {
                  ...progress,
                  taskId,
                  imageId: report.imageId
                })
            }
          })
          signal.throwIfAborted()
          const directory = resolve(getRuntimeRoot(app.getAppPath()), 'work/analysis-runs', taskId, 'reports')
          await mkdir(directory, { recursive: true })
          await writeFile(resolve(directory, 'explanation.json'), JSON.stringify(result, null, 2))
          return result
        })

        return { ok: true, data: explanation }
      } catch (error) {
        return failure(error)
      }
    }
  )
}
