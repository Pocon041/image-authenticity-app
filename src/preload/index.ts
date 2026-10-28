import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AnalysisProgress, type DesktopAPI } from '../shared/contracts'

const desktop: DesktopAPI = {
  openReportDirectory: (taskId) => ipcRenderer.invoke(IPC.openReportDirectory, taskId),
  chooseImage: () => ipcRenderer.invoke(IPC.chooseImage),
  clearImage: () => ipcRenderer.invoke(IPC.clearImage),
  analyze: (imageId, taskId, backend, options) =>
    ipcRenderer.invoke(IPC.analyze, imageId, taskId, backend, options),
  cancelAnalysis: (taskId) => ipcRenderer.invoke(IPC.cancelAnalysis, taskId),
  onAnalysisProgress(listener) {
    const handler = (_event: Electron.IpcRendererEvent, progress: AnalysisProgress) =>
      listener(progress)
    ipcRenderer.on(IPC.progress, handler)
    return () => ipcRenderer.removeListener(IPC.progress, handler)
  }
}

contextBridge.exposeInMainWorld('desktop', desktop)
