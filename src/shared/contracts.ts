export const IPC = {
  chooseImage: 'srdp:image:choose',
  clearImage: 'srdp:image:clear',
  analyze: 'srdp:analysis:run',
  cancelAnalysis: 'srdp:analysis:cancel',
  progress: 'srdp:analysis:progress'
} as const

export type ErrorCode =
  | 'INVALID_IMAGE'
  | 'STALE_IMAGE'
  | 'BUSY'
  | 'CANCELLED'
  | 'UNTRUSTED'
  | 'INVALID_REQUEST'
  | 'INTERNAL'
export type Response<T> = { ok: true; data: T } | { ok: false; error: string; code: ErrorCode }

export interface AnalysisProgress {
  taskId: string
  imageId: string
  stage: 'preparing' | 'analyzing' | 'describing'
  percent: number
  label: string
}

export interface ImageAsset {
  id: string
  name: string
  size: number
  width: number
  height: number
  mimeType: string
  dataUrl: string
}

export interface AnalysisReport {
  id: string
  imageId: string
  mode: 'mock'
  createdAt: string
  elapsedMs: number
  title: string
  summary: string
  sections: { title: string; description: string }[]
  disclaimer: string
}

export interface DesktopAPI {
  chooseImage(): Promise<Response<ImageAsset | null>>
  clearImage(): Promise<Response<null>>
  analyze(imageId: string, taskId: string): Promise<Response<AnalysisReport>>
  cancelAnalysis(taskId: string): Promise<Response<boolean>>
  onAnalysisProgress(listener: (progress: AnalysisProgress) => void): () => void
}
