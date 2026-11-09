import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AnalysisProgress,
  type ExplanationProgress,
  type RuntimeSetupProgress,
  type DesktopAPI
} from '../shared/contracts'

const desktop: DesktopAPI = {
  runtimeEnvironment: () => ipcRenderer.invoke(IPC.runtimeEnvironment),
  chooseRuntimeDirectory: () => ipcRenderer.invoke(IPC.chooseRuntimeDirectory),
  chooseRuntimeBundle: () => ipcRenderer.invoke(IPC.chooseRuntimeBundle),
  openRuntimeDirectory: () => ipcRenderer.invoke(IPC.openRuntimeDirectory),
  prepareRuntime: () => ipcRenderer.invoke(IPC.prepareRuntime),
  cancelRuntimeSetup: () => ipcRenderer.invoke(IPC.cancelRuntimeSetup),
  onRuntimeSetupProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, progress: RuntimeSetupProgress) => listener(progress)
    ipcRenderer.on(IPC.runtimeSetupProgress, handler)
    return () => ipcRenderer.removeListener(IPC.runtimeSetupProgress, handler)
  },
  openReportDirectory: (taskId) => ipcRenderer.invoke(IPC.openReportDirectory, taskId),
  chooseImage: () => ipcRenderer.invoke(IPC.chooseImage),
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
