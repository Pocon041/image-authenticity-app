import type { DecisionConfidence, ModelSupport } from './decision-confidence'

export const IPC = {
  setWindowTheme: 'srdp:window:theme',
  runtimeEnvironment: 'srdp:runtime:info',
  chooseRuntimeDirectory: 'srdp:runtime:choose-directory',
  chooseRuntimeBundle: 'srdp:runtime:choose-bundle',
  openRuntimeDirectory: 'srdp:runtime:open-directory',
  prepareRuntime: 'srdp:runtime:prepare',
  cancelRuntimeSetup: 'srdp:runtime:cancel-setup',
  runtimeSetupProgress: 'srdp:runtime:setup-progress',
  chooseImage: 'srdp:image:choose',
  importDroppedImage: 'srdp:image:drop',
  pasteImage: 'srdp:image:paste',
  clearImage: 'srdp:image:clear',
  analyze: 'srdp:analysis:run',
  cancelAnalysis: 'srdp:analysis:cancel',
  progress: 'srdp:analysis:progress',
  openReportDirectory: 'srdp:analysis:open-directory',
  listHistory: 'srdp:history:list',
  openHistory: 'srdp:history:open',
  explain: 'srdp:analysis:explain', // 第四人新增
  cancelExplain: 'srdp:analysis:cancel-explain', // 第四人新增
  explanationProgress: 'srdp:analysis:explanation-progress' // 第四人新增
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
  workflowPhase?: 'prepare' | 'routing' | 'detectors' | 'aggregate'
  routingStatus?: 'completed' | 'failed' | 'skipped'
}

export type ContentType = 'photo' | 'document' | 'unsure'
// [第三人任务] FSD 是联合流程的首个独立检测步骤。
export type DetectorBackend = 'aigc' | 'sica' | 'rita' | 'rise'
export interface WorkflowOptions {
  contentType: ContentType | 'auto'
  supplementFromTaskId?: string
}
// 预处理后的内容路由证据：只决定检测器组合，不构成篡改结论。
export interface WorkflowRouting {
  mode: 'auto' | 'manual'
  status: 'completed' | 'failed' | 'skipped'
  decision: ContentType | null
  scores: { photo: number; document: number } | null
  margin: number | null
  marginThreshold: number | null
  elapsedMs: number
  error?: { code: string; message: string }
}
export interface WorkflowStep {
  backend: DetectorBackend
  message?: string
  // Bounded renderer preview only; never expose model bundles or filesystem paths in progress.
  preview?: LocalizationPreview
  status: 'pending' | 'running' | 'completed' | 'failed' | 'not_run' | 'reused' | 'cancelled'
}
export interface LocalizationPreview {
  overlayDataUrl: string
  regionCount: number
  manipulatedAreaFraction: number
}
export interface ExplanationProgress {
  taskId: string
  imageId: string
  phase: 'observing' | 'synthesizing' | 'retrying' | 'finished'
  label: string
  text?: string
  decision?: import('./protocol').FinalDecision
}
export interface DetectorResult {
  backend: DetectorBackend
  status: 'completed' | 'failed' | 'not_run'
  elapsedMs: number
  reused?: boolean
  error?: { code: string; message: string }
  classification?: NonNullable<AnalysisReport['classification']>
  localization?: NonNullable<AnalysisReport['localization']>
  aigc?: NonNullable<AnalysisReport['aigc']>
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
  routing?: WorkflowRouting
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
  historyWarning?: string
  workflow?: WorkflowResult
  localization?: {
    confidence?: ModelSupport | null
    decision: string
    score: number | null
    regionCount: number
    manipulatedAreaFraction: number
    overlayDataUrl: string
    bundlePath: string
    bundle: Record<string, unknown>
  }
  classification?: {
    confidence?: ModelSupport | null
    decision: 'fake' | 'real'
    score: number
    threshold: number
    checkpointVariant: string
    decisionConfidence?: DecisionConfidence | null
    bundlePath: string
    bundle: Record<string, unknown>
  }
  // [第三人任务] FSD 返回 z-score，不将其伪装成概率；归因来源可能为空。
  aigc?: {
    confidence?: ModelSupport | null
    decision: 'ai_generated' | 'non_ai' | 'inconclusive'
    zScore: number
    threshold: number
    decisionConfidence?: DecisionConfidence | null
    attributedSource: string | null
    attributionScore: number | null
    bundlePath: string
    bundle: Record<string, unknown>
  }
  // 第四人-解释模块的输出
  explanation?: import('./protocol').ExplanationReport
}

export interface HistoryEntry {
  id: string
  name: string
  createdAt: string
  backend: AnalysisBackend
  mode: 'mock' | 'local'
  status: 'completed' | 'partial' | 'failed'
  width: number
  height: number
  thumbnailDataUrl: string
}

export interface HistoryPage {
  entries: HistoryEntry[]
  total: number
  skipped: number
}

export interface HistorySelection {
  image: ImageAsset
  report: AnalysisReport
}

// [第三人任务] 独立 FSD AIGC 检测入口。
export type AnalysisBackend = 'workflow' | 'mock' | 'rita' | 'sica' | 'rise' | 'aigc'

export interface RuntimeEnvironment {
  packaged: boolean
  version: string
  directory: string | null
  configurations: { name: string; configured: boolean }[]
  setup: RuntimeSetupStatus
}

export interface RuntimeSetupProgress {
  stage: 'verifying' | 'extracting' | 'checking' | 'starting' | 'completed' | 'failed' | 'cancelled'
  label: string
  completed: number
  total: number
}

export interface RuntimeSetupStatus {
  available: boolean
  ready: boolean
  running: boolean
  progress?: RuntimeSetupProgress
}

export interface DesktopAPI {
  setWindowTheme(theme: WindowTheme): Promise<Response<null>>
  listHistory(query: string, offset: number): Promise<Response<HistoryPage>>
  openHistory(taskId: string): Promise<Response<HistorySelection>>
  runtimeEnvironment(): Promise<Response<RuntimeEnvironment>>
  chooseRuntimeDirectory(): Promise<Response<RuntimeEnvironment | null>>
  chooseRuntimeBundle(): Promise<Response<RuntimeEnvironment | null>>
  openRuntimeDirectory(): Promise<Response<null>>
  prepareRuntime(): Promise<Response<RuntimeEnvironment>>
  cancelRuntimeSetup(): Promise<Response<boolean>>
  onRuntimeSetupProgress(listener: (progress: RuntimeSetupProgress) => void): () => void
  openReportDirectory(taskId: string): Promise<Response<null>>
  chooseImage(): Promise<Response<ImageAsset | null>>
  importDroppedImage(files: File[]): Promise<Response<ImageAsset | null>>
  pasteImage(): Promise<Response<ImageAsset | null>>
  clearImage(): Promise<Response<null>>
  analyze(
    imageId: string,
    taskId: string,
    backend?: AnalysisBackend,
    options?: WorkflowOptions
  ): Promise<Response<AnalysisReport>>
  cancelAnalysis(taskId: string): Promise<Response<boolean>>
  explain(taskId: string): Promise<Response<import('./protocol').ExplanationReport>>
  onExplanationProgress(listener: (progress: ExplanationProgress) => void): () => void
  onAnalysisProgress(listener: (progress: AnalysisProgress) => void): () => void
}

export interface WindowTheme {
  mode: 'light' | 'dark' | 'system'
  background: string
  foreground: string
}
