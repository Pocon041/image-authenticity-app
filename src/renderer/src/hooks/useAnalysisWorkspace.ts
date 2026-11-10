import { useEffect, useRef, useState } from 'react'
import type {
  AnalysisBackend,
  AnalysisProgress,
  AnalysisReport,
  ContentType,
  ImageAsset,
  Response
} from '../../../shared/contracts'

export function useAnalysisWorkspace() {
  const [image, setImage] = useState<ImageAsset | null>(null)
  const [backend, setBackend] = useState<AnalysisBackend>('workflow')
  const [contentType, setContentType] = useState<ContentType | 'auto'>('auto')
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [viewingHistory, setViewingHistory] = useState(false)
  const [imageView, setImageView] = useState<{ taskId: string; view: string } | null>(null)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [lastProgress, setLastProgress] = useState<AnalysisProgress | null>(null)
  const [status, setStatus] = useState<'idle' | 'picking' | 'running' | 'cancelling'>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const locked = useRef(false)
  const currentTask = useRef<string | null>(null)
  const progressTrace = useRef<AnalysisProgress | null>(null)

  useEffect(
    () =>
      window.desktop.onAnalysisProgress((event) => {
        if (event.taskId === currentTask.current) {
          // Preview bytes arrive once at completion, not on every later progress tick.
          const previous =
            progressTrace.current?.taskId === event.taskId ? progressTrace.current : null
          const merged = {
            ...event,
            steps: event.steps?.map((step) => {
              const preview =
                step.preview ??
                previous?.steps?.find((item) => item.backend === step.backend)?.preview
              return preview ? { ...step, preview } : step
            })
          }
          progressTrace.current = merged
          setProgress(merged)
          setLastProgress(merged)
        }
      }),
    []
  )

  async function acquireImage(read: () => Promise<Response<ImageAsset | null>>) {
    if (locked.current) return
    locked.current = true
    setError('')
    setNotice('')
    setStatus('picking')
    try {
      const result = await read()
      if (!result.ok) setError(result.error)
      else if (result.data) {
        setViewingHistory(false)
        setImage(result.data)
        setReport(null)
        setImageView(null)
        setProgress(null)
        setLastProgress(null)
        progressTrace.current = null
      }
    } catch {
      setError('无法导入图片，请重新尝试。')
    } finally {
      locked.current = false
      setStatus('idle')
    }
  }

  const chooseImage = () => acquireImage(() => window.desktop.chooseImage())
  const importDroppedImage = (files: File[]) =>
    acquireImage(() => window.desktop.importDroppedImage(files))
  const pasteImage = () => acquireImage(() => window.desktop.pasteImage())

  async function openHistory(taskId: string): Promise<boolean> {
    if (locked.current) return false
    locked.current = true
    setStatus('picking')
    try {
      const result = await window.desktop.openHistory(taskId)
      if (!result.ok) {
        setError(result.error)
        return false
      }
      setImage(result.data.image)
      setReport(result.data.report)
      setBackend(result.data.report.backend ?? 'workflow')
      setContentType(result.data.report.workflow?.contentType ?? 'auto')
      setImageView(null)
      setProgress(null)
      setLastProgress(null)
      progressTrace.current = null
      setError('')
      setNotice('')
      setViewingHistory(true)
      return true
    } catch {
      setError('无法打开历史记录，请重试。')
      return false
    } finally {
      locked.current = false
      setStatus('idle')
    }
  }

  async function analyze(supplement = false) {
    if (!image || locked.current) return
    locked.current = true
    const taskId = crypto.randomUUID()
    currentTask.current = taskId
    setError('')
    setNotice('')
    setViewingHistory(false)
    if (!supplement) {
      setReport(null)
      setImageView(null)
    }
    setProgress(null)
    setLastProgress(null)
    progressTrace.current = null
    setStatus('running')
    try {
      const result = await window.desktop.analyze(
        image.id,
        taskId,
        backend,
        backend === 'workflow'
          ? {
              contentType,
              ...(supplement && report?.workflow ? { supplementFromTaskId: report.id } : {})
            }
          : undefined
      )
      if (!result.ok) {
        if (result.code === 'CANCELLED')
          setNotice(
            backend === 'mock'
              ? '模拟分析已取消，可以重新开始。'
              : `${backend === 'workflow' ? '联合' : backend === 'rise' ? 'RiSE' : backend === 'sica' ? 'SICA' : 'RITA'} 分析已取消，可以重新开始。${supplement ? '上一份证据仍保留。' : ''}`
          )
        else setError(result.error)
      } else if (result.data.imageId === image.id) {
        setReport(result.data)
        if (result.data.historyWarning) setNotice(result.data.historyWarning)
      }
    } catch {
      setError('分析失败，请重试。')
    } finally {
      if (currentTask.current === taskId) {
        currentTask.current = null
        locked.current = false
        setStatus('idle')
        setProgress(null)
      }
    }
  }

  async function cancel() {
    const taskId = currentTask.current
    if (!taskId) return
    setStatus('cancelling')
    try {
      const result = await window.desktop.cancelAnalysis(taskId)
      if (!result.ok) {
        setError(result.error)
        if (currentTask.current === taskId) setStatus('running')
      }
    } catch {
      setError('取消请求失败，请重试。')
      if (currentTask.current === taskId) setStatus('running')
    }
  }

  async function clearImage() {
    if (locked.current) return
    locked.current = true
    try {
      const result = await window.desktop.clearImage()
      if (!result.ok) setError(result.error)
      else {
        setViewingHistory(false)
        setImage(null)
        setReport(null)
        setImageView(null)
        setProgress(null)
        setLastProgress(null)
        progressTrace.current = null
        setError('')
        setNotice('')
      }
    } catch {
      setError('清空图片失败，请重试。')
    } finally {
      locked.current = false
    }
  }

  return {
    backend,
    contentType,
    selectContentType(next: ContentType | 'auto') {
      if (locked.current) return
      setViewingHistory(false)
      setContentType(next)
      setReport(null)
      setImageView(null)
      setProgress(null)
      setLastProgress(null)
      progressTrace.current = null
      setError('')
      setNotice('')
    },
    selectBackend(next: AnalysisBackend) {
      if (locked.current) return
      setViewingHistory(false)
      setBackend(next)
      setReport(null)
      setImageView(null)
      setError('')
      setNotice('')
      setProgress(null)
      setLastProgress(null)
      progressTrace.current = null
    },
    image,
    report,
    viewingHistory,
    imageView,
    selectImageView(view: string) {
      if (!report || report.imageId !== image?.id || status !== 'idle') return
      setImageView({ taskId: report.id, view })
    },
    progress,
    lastProgress,
    status,
    error,
    notice,
    busy: status !== 'idle',
    running: status === 'running' || status === 'cancelling',
    chooseImage,
    importDroppedImage,
    pasteImage,
    openHistory,
    analyze: () => analyze(false),
    supplement: () => analyze(true),
    cancel,
    clearImage,
    dismissError: () => setError('')
  }
}

export type AnalysisWorkspace = ReturnType<typeof useAnalysisWorkspace>
