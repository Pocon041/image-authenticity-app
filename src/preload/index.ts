import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AnalysisProgress,
  type ExplanationProgress,
  type RuntimeSetupProgress,
  type DesktopAPI
} from '../shared/contracts'

const desktop: DesktopAPI = {
  setWindowTheme: (theme) => ipcRenderer.invoke(IPC.setWindowTheme, theme),
  listHistory: (query, offset) => ipcRenderer.invoke(IPC.listHistory, query, offset),
  openHistory: (taskId) => ipcRenderer.invoke(IPC.openHistory, taskId),
  runtimeEnvironment: () => ipcRenderer.invoke(IPC.runtimeEnvironment),
  chooseRuntimeDirectory: () => ipcRenderer.invoke(IPC.chooseRuntimeDirectory),
  chooseRuntimeBundle: () => ipcRenderer.invoke(IPC.chooseRuntimeBundle),
  openRuntimeDirectory: () => ipcRenderer.invoke(IPC.openRuntimeDirectory),
  prepareRuntime: () => ipcRenderer.invoke(IPC.prepareRuntime),
  cancelRuntimeSetup: () => ipcRenderer.invoke(IPC.cancelRuntimeSetup),
  onRuntimeSetupProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, progress: RuntimeSetupProgress) =>
      listener(progress)
    ipcRenderer.on(IPC.runtimeSetupProgress, handler)
    return () => ipcRenderer.removeListener(IPC.runtimeSetupProgress, handler)
  },
  openReportDirectory: (taskId) => ipcRenderer.invoke(IPC.openReportDirectory, taskId),
  chooseImage: () => ipcRenderer.invoke(IPC.chooseImage),
  async importDroppedImage(files) {
    try {
      if (!Array.isArray(files) || files.length !== 1) {
        return { ok: false, code: 'INVALID_IMAGE', error: '请每次拖入一张图片。' }
      }
      const path = webUtils.getPathForFile(files[0])
      if (!path)
        return { ok: false, code: 'INVALID_IMAGE', error: '请从文件夹拖入图片，或使用粘贴导入。' }
      return ipcRenderer.invoke(IPC.importDroppedImage, path)
    } catch {
      return { ok: false, code: 'INVALID_IMAGE', error: '无法读取拖入的文件，请重新选择图片。' }
    }
  },
  pasteImage: () => ipcRenderer.invoke(IPC.pasteImage),
  clearImage: () => ipcRenderer.invoke(IPC.clearImage),
  analyze: (imageId, taskId, backend, options) =>
    ipcRenderer.invoke(IPC.analyze, imageId, taskId, backend, options),
  cancelAnalysis: (taskId) => ipcRenderer.invoke(IPC.cancelAnalysis, taskId),
  // 新增：第四人的解释生成接口
  explain: (taskId) => ipcRenderer.invoke(IPC.explain, taskId),
  onExplanationProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, progress: ExplanationProgress) =>
      listener(progress)
    ipcRenderer.on(IPC.explanationProgress, handler)
    return () => ipcRenderer.removeListener(IPC.explanationProgress, handler)
  },
  onAnalysisProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, progress: AnalysisProgress) =>
      listener(progress)
    ipcRenderer.on(IPC.progress, handler)
    return () => ipcRenderer.removeListener(IPC.progress, handler)
  }
}

contextBridge.exposeInMainWorld('desktop', desktop)
