export const IPC = {
  chooseImage: 'srdp:image:choose',
  clearImage: 'srdp:image:clear',
  analyze: 'srdp:analysis:run',
  cancelAnalysis: 'srdp:analysis:cancel',
  progress: 'srdp:analysis:progress',
  openReportDirectory: 'srdp:analysis:open-directory'
} as const

export type ErrorCode =
  | 'INVALID_IMAGE'
  | 'STALE_IMAGE'
  | 'BUSY'
  | 'CANCELLED'
  | 'UNTRUSTED'
  | 'INVALID_REQUEST'
  | 'INTERNAL'
  | 'MODEL_NOT_READY'
  | 'INVALID_MODEL'
  | 'INFERENCE_FAILED'
  | 'TIMEOUT'
export type Response<T> = { ok: true; data: T } | { ok: false; error: string; code: ErrorCode }

export interface AnalysisProgress {
  taskId: string
  imageId: string
  stage: 'preparing' | 'analyzing' | 'describing'
  percent: number
  label: string
  steps?: WorkflowStep[]
}

export type ContentType = 'photo' | 'document' | 'unsure'
export type DetectorBackend = 'sica' | 'rita' | 'rise'
export interface WorkflowOptions {
  contentType: ContentType
  supplementFromTaskId?: string
}
export interface WorkflowStep {
  backend: DetectorBackend
  status: 'pending' | 'running' | 'completed' | 'failed' | 'not_run' | 'reused' | 'cancelled'
}
export interface DetectorResult {
  backend: DetectorBackend
  status: 'completed' | 'failed' | 'not_run'
  elapsedMs: number
  reused?: boolean
  error?: { code: string; message: string }
  classification?: NonNullable<AnalysisReport['classification']>
  localization?: NonNullable<AnalysisReport['localization']>
  regionPreviews?: {
    regionId: string
    bboxXYWH: number[]
    areaPixels: number | null
    dataUrl: string
  }[]
}
export interface WorkflowResult {
  contentType: ContentType
  primary: 'rita' | 'rise' | null
  status: 'completed' | 'partial' | 'failed'
  detectors: DetectorResult[]
  flags: string[]
  bundlePath: string
  bundle: Record<string, unknown>
  summaryPath: string
  summary: Record<string, unknown>
  previousTaskId?: string
}

export interface ImageAsset {
  id: string
  sha256: string
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
  backend?: AnalysisBackend
  mode: 'mock' | 'local'
  createdAt: string
  elapsedMs: number
  title: string
  summary: string
  sections: { title: string; description: string }[]
  disclaimer: string
  workflow?: WorkflowResult
  localization?: {
    decision: string
    score: number | null
    regionCount: number
    manipulatedAreaFraction: number
    overlayDataUrl: string
    bundlePath: string
    bundle: Record<string, unknown>
  }
  classification?: {
    decision: 'fake' | 'real'
    score: number
    threshold: number
    checkpointVariant: string
    bundlePath: string
    bundle: Record<string, unknown>
  }
}

export type AnalysisBackend = 'workflow' | 'mock' | 'rita' | 'sica' | 'rise'

export interface DesktopAPI {
  openReportDirectory(taskId: string): Promise<Response<null>>
  chooseImage(): Promise<Response<ImageAsset | null>>
  clearImage(): Promise<Response<null>>
  analyze(
    imageId: string,
    taskId: string,
    backend?: AnalysisBackend,
    options?: WorkflowOptions
  ): Promise<Response<AnalysisReport>>
  cancelAnalysis(taskId: string): Promise<Response<boolean>>
  onAnalysisProgress(listener: (progress: AnalysisProgress) => void): () => void
}
