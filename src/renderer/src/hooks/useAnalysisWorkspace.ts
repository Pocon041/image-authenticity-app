import { useEffect, useRef, useState } from 'react'
import type {
  AnalysisBackend,
  AnalysisProgress,
  AnalysisReport,
  ImageAsset
} from '../../../shared/contracts'

export function useAnalysisWorkspace() {
  const [image, setImage] = useState<ImageAsset | null>(null)
  const [backend, setBackend] = useState<AnalysisBackend>('mock')
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [progress, setProgress] = useState<AnalysisProgress | null>(null)
  const [status, setStatus] = useState<'idle' | 'picking' | 'running' | 'cancelling'>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const locked = useRef(false)
  const currentTask = useRef<string | null>(null)

  useEffect(
    () =>
      window.desktop.onAnalysisProgress((event) => {
        if (event.taskId === currentTask.current) setProgress(event)
      }),
    []
  )

  async function chooseImage() {
    if (locked.current) return
    locked.current = true
    setError('')
    setNotice('')
    setStatus('picking')
    try {
      const result = await window.desktop.chooseImage()
      if (!result.ok) setError(result.error)
      else if (result.data) {
        setImage(result.data)
        setReport(null)
        setProgress(null)
      }
    } catch {
      setError('无法打开图片，请重新尝试。')
    } finally {
      locked.current = false
      setStatus('idle')
    }
  }

  async function analyze() {
    if (!image || locked.current) return
    locked.current = true
    const taskId = crypto.randomUUID()
    currentTask.current = taskId
    setError('')
    setNotice('')
    setReport(null)
    setProgress(null)
    setStatus('running')
    try {
      const result = await window.desktop.analyze(image.id, taskId, backend)
      if (!result.ok) {
        if (result.code === 'CANCELLED')
          setNotice(
            backend === 'mock'
              ? '模拟分析已取消，可以重新开始。'
              : `${backend === 'sica' ? 'SICA' : 'RITA'} 分析已取消，可以重新开始。`
          )
        else setError(result.error)
      } else if (result.data.imageId === image.id) setReport(result.data)
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
        setImage(null)
        setReport(null)
        setProgress(null)
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
    selectBackend(next: AnalysisBackend) {
      if (locked.current) return
      setBackend(next)
      setReport(null)
      setError('')
      setNotice('')
      setProgress(null)
    },
    image,
    report,
    progress,
    status,
    error,
    notice,
    busy: status !== 'idle',
    running: status === 'running' || status === 'cancelling',
    chooseImage,
    analyze,
    cancel,
    clearImage,
    dismissError: () => setError('')
  }
}

export type AnalysisWorkspace = ReturnType<typeof useAnalysisWorkspace>
