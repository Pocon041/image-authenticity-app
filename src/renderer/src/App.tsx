import { useEffect, useRef, useState } from 'react'
import { Clock3, ScanLine, ImagePlus, Info, Settings2, X } from 'lucide-react'
import { AnalysisPanel } from './components/AnalysisPanel'
import { ImagePanel } from './components/ImagePanel'
import { SettingsDialog } from './components/SettingsDialog'
import { HistoryDialog } from './components/HistoryDialog'
import { SplitWorkspace } from './components/SplitWorkspace'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { useAnalysisWorkspace } from './hooks/useAnalysisWorkspace'

const modeLabels = {
  workflow: '',
  mock: '模拟模式 · 使用演示结果',
  sica: 'SICA · 整图分类',
  rise: 'RiSE · 文档定位',
  rita: 'RITA · 照片定位',
  aigc: 'FSD · AI 生成检测'
}

export function App() {
  const workspace = useAnalysisWorkspace()
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const workflow = workspace.backend === 'workflow'
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    const isFileDrag = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')
    function enter(event: DragEvent) {
      if (!isFileDrag(event)) return
      event.preventDefault()
      dragDepth.current++
      if (!workspace.busy && !document.querySelector('dialog[open]')) setDragging(true)
    }
    function leave(event: DragEvent) {
      if (!isFileDrag(event)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDragging(false)
    }
    function over(event: DragEvent) {
      event.preventDefault()
      if (event.dataTransfer)
        event.dataTransfer.dropEffect =
          workspace.busy || document.querySelector('dialog[open]') ? 'none' : 'copy'
    }
    function drop(event: DragEvent) {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (workspace.busy || document.querySelector('dialog[open]')) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length) void workspace.importDroppedImage(files)
    }
    const reset = () => {
      dragDepth.current = 0
      setDragging(false)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
      window.removeEventListener('blur', reset)
    }
  }, [workspace.busy, workspace.importDroppedImage])

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (document.querySelector('dialog[open]')) return
      if ((event.target as HTMLElement)?.closest('input, textarea, [contenteditable="true"]'))
        return
      if (event.key === ',') {
        event.preventDefault()
        settingsDialog.current?.showModal()
      } else if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        void workspace.chooseImage()
      } else if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void workspace.pasteImage()
      } else if (event.key.toLowerCase() === 'h' && !workspace.busy) {
        event.preventDefault()
        setHistoryOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [workspace.chooseImage, workspace.pasteImage, workspace.busy])

  return (
    <WorkspaceLayout
      actions={
        <>
          <button
            className="navigation-button"
            aria-label="图像分析"
            aria-pressed={!historyOpen}
            title="图像分析"
            onClick={() => setHistoryOpen(false)}
          >
            <ScanLine size={21} />
            <span>分析</span>
          </button>
          <button
            className="navigation-button"
            disabled={workspace.busy}
            aria-label="历史记录"
            aria-pressed={historyOpen}
            title="历史记录 (Ctrl+H)"
            onClick={() => setHistoryOpen(true)}
          >
            <Clock3 size={21} />
            <span>历史</span>
          </button>
        </>
      }
      utilities={
        <button
          className="navigation-button"
          aria-label="设置"
          title="设置 (Ctrl+,)"
          onClick={() => settingsDialog.current?.showModal()}
        >
          <Settings2 size={21} />
          <span>设置</span>
        </button>
      }
    >
      {!workflow && (
        <div className="demo-notice">
          <Info size={16} />
          {modeLabels[workspace.backend]}
        </div>
      )}
      {workspace.error && (
        <div role="alert" className="error-notice">
          <Info size={17} />
          <span>{workspace.error}</span>
          <button aria-label="关闭错误提示" onClick={workspace.dismissError}>
            <X size={16} />
          </button>
        </div>
      )}
      {workspace.notice && (
        <div role="status" className="task-notice">
          <Info size={16} />
          {workspace.notice}
        </div>
      )}
      <SplitWorkspace
        image={<ImagePanel workspace={workspace} />}
        report={<AnalysisPanel workspace={workspace} />}
        workflow={workflow}
      />
      {dragging && (
        <div className="app-drop-overlay" role="status">
          <ImagePlus size={32} />
          <strong>松开以导入图片</strong>
        </div>
      )}
      <SettingsDialog dialogRef={settingsDialog} workspace={workspace} />
      <HistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        workspace={workspace}
      />
    </WorkspaceLayout>
  )
}
