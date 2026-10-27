import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { IPC, type Response, type ImageAsset } from '../shared/contracts'
import { AppError, failure } from './errors'
import { importImage } from './image-import'
import type { AnalysisSession } from './services/analysis-session'

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
    async (event, imageId: unknown, taskId: unknown, backend: unknown = 'mock') => {
      try {
        const window = requireWindow(event)
        validateId(imageId, true)
        validateId(taskId)
        if (backend !== 'mock' && backend !== 'rita' && backend !== 'sica')
          throw new AppError('INVALID_REQUEST', '未知的分析服务。')
        if (picking) throw new AppError('BUSY', '请等待图片导入结束。')
        const report = await session.analyze(
          imageId,
          taskId,
          (progress) => {
            if (!window.isDestroyed()) window.webContents.send(IPC.progress, progress)
          },
          backend
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
}
