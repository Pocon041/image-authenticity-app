import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

const defaultRatio = 0.34
const storageKey = 'authenticity.report-width'

export function SplitWorkspace({
  image,
  report,
  workflow
}: {
  image: ReactNode
  report: ReactNode
  workflow: boolean
}) {
  const element = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)
  const [width, setWidth] = useState(0)
  const [ratio, setRatio] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return saved > 0.1 && saved < 0.9 ? saved : defaultRatio
    } catch {
      return defaultRatio
    }
  })
  const [resizing, setResizing] = useState(false)
  const latestRatio = useRef(ratio)
  const min = 320
  const max = Math.max(min, (width || 1360) - 368)
  const reportWidth = Math.max(min, Math.min(max, (width || 1360) * ratio))

  useEffect(() => {
    if (!element.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])

  function update(next: number, persist = false) {
    const bounded = Math.max(min, Math.min(max, next)) / (width || 1360)
    setRatio(bounded)
    latestRatio.current = bounded
    if (persist) {
      try {
        localStorage.setItem(storageKey, String(bounded))
      } catch {
        /* Storage is optional. */
      }
    }
  }
  function finish() {
    drag.current = null
    setResizing(false)
    try {
      localStorage.setItem(storageKey, String(latestRatio.current))
    } catch {
      /* Storage is optional. */
    }
  }

  return (
    <div
      ref={element}
      className={`analysis-grid ${workflow ? 'workflow-grid' : ''} ${resizing ? 'is-resizing' : ''}`}
      style={{ '--inspector-width': `${reportWidth}px` } as CSSProperties}
      data-testid="split-workspace"
    >
      {image}
      <div
        className="workspace-divider"
        role="separator"
        aria-label="调整图像与报告宽度"
        aria-orientation="vertical"
        aria-valuemin={Math.round(min)}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(reportWidth)}
        aria-valuetext={`报告宽度 ${Math.round(reportWidth)} 像素`}
        tabIndex={0}
        title="拖动调整宽度，双击还原"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          drag.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
          setResizing(true)
        }}
        onPointerMove={(event) => {
          if (drag.current !== event.pointerId || !element.current) return
          update(element.current.getBoundingClientRect().right - event.clientX)
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={() => {
          if (drag.current !== null) finish()
        }}
        onDoubleClick={() => update(width * defaultRatio, true)}
        onKeyDown={(event) => {
          const actions: Record<string, number> = {
            ArrowLeft: reportWidth + (event.shiftKey ? 48 : 16),
            ArrowRight: reportWidth - (event.shiftKey ? 48 : 16),
            Home: min,
            End: max,
            Enter: width * defaultRatio
          }
          if (event.key in actions) {
            event.preventDefault()
            update(actions[event.key], true)
          }
        }}
      >
        <span aria-hidden="true" />
      </div>
      {report}
    </div>
  )
}
