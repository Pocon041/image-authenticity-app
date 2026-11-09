import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'

export function ImageViewport({
  src,
  alt,
  originalSrc,
  scanning = false,
  localized = false,
  testId = 'image-preview'
}: {
  src: string
  alt: string
  originalSrc?: string
  scanning?: boolean
  localized?: boolean
  testId?: string
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [natural, setNatural] = useState({ width: 0, height: 0 })
  const [mode, setMode] = useState<'fit' | 'actual' | 'custom'>('fit')
  const [zoom, setZoom] = useState(1)
  const [panning, setPanning] = useState(false)
  const pan = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const anchor = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null)

  useLayoutEffect(() => {
    if (!viewport.current) return
    setSize({ width: viewport.current.clientWidth, height: viewport.current.clientHeight })
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    )
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])

  const fittedScale =
    natural.width && natural.height && size.width && size.height
      ? Math.min(
          Math.max(1, size.width - 24) / natural.width,
          Math.max(1, size.height - 60) / natural.height,
          2
        )
      : 1
  const scale = mode === 'fit' ? fittedScale : zoom
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const width = natural.width ? natural.width * scale : undefined
  const height = natural.height ? natural.height * scale : undefined

  function zoomAt(next: number, clientX?: number, clientY?: number) {
    const scroll = scroller.current
    const picture = image.current
    if (!scroll || !picture) return
    const bounds = scroll.getBoundingClientRect()
    const current = picture.getBoundingClientRect()
    const x = clientX ?? bounds.left + bounds.width / 2
    const y = clientY ?? bounds.top + bounds.height / 2
    anchor.current = {
      x: (x - current.left) / scaleRef.current,
      y: (y - current.top) / scaleRef.current,
      clientX: x,
      clientY: y
    }
    const bounded = Math.max(0.1, Math.min(8, next))
    setZoom(bounded)
    setMode(Math.abs(bounded - 1) < 0.001 ? 'actual' : 'custom')
  }

  useLayoutEffect(() => {
    if (!scroller.current || !image.current) return
    if (mode === 'fit') {
      scroller.current.scrollTo(0, 0)
      anchor.current = null
    } else if (anchor.current) {
      const point = anchor.current
      const bounds = image.current.getBoundingClientRect()
      scroller.current.scrollLeft += bounds.left + point.x * scale - point.clientX
      scroller.current.scrollTop += bounds.top + point.y * scale - point.clientY
      anchor.current = null
    }
  }, [scale, mode, natural.width, natural.height])

  const zoomHandler = useRef(zoomAt)
  zoomHandler.current = zoomAt
  useEffect(() => {
    const scroll = scroller.current
    if (!scroll) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1)
      zoomHandler.current(scaleRef.current * Math.exp(-delta * 0.002), event.clientX, event.clientY)
    }
    scroll.addEventListener('wheel', wheel, { passive: false })
    return () => scroll.removeEventListener('wheel', wheel)
  }, [])

  function finishPan() {
    pan.current = null
    setPanning(false)
  }
  function fit() {
    anchor.current = null
    setMode('fit')
  }

  return (
    <div
      className={`image-viewport ${scanning ? 'is-scanning' : ''} ${panning ? 'is-panning' : ''}`}
      ref={viewport}
      data-mode={mode}
    >
      <div
        className="image-stage-scroll"
        ref={scroller}
        tabIndex={0}
        aria-label="图像画布"
        title="滚轮缩放，放大后拖动平移，双击切换适应窗口"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          event.currentTarget.focus({ preventScroll: true })
          pan.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: event.currentTarget.scrollLeft,
            top: event.currentTarget.scrollTop
          }
          event.currentTarget.setPointerCapture(event.pointerId)
          setPanning(true)
        }}
        onPointerMove={(event) => {
          const start = pan.current
          if (!start || start.id !== event.pointerId) return
          event.currentTarget.scrollLeft = start.left - (event.clientX - start.x)
          event.currentTarget.scrollTop = start.top - (event.clientY - start.y)
        }}
        onPointerUp={finishPan}
        onPointerCancel={finishPan}
        onLostPointerCapture={finishPan}
        onDoubleClick={(event) =>
          mode === 'fit' ? zoomAt(Math.max(1, scale * 2), event.clientX, event.clientY) : fit()
        }
        onKeyDown={(event) => {
          if (event.key === '+' || event.key === '=') {
            event.preventDefault()
            zoomAt(scale * 1.25)
          }
          if (event.key === '-') {
            event.preventDefault()
            zoomAt(scale / 1.25)
          }
          if (event.key === '0') {
            event.preventDefault()
            fit()
          }
          if (event.key === '1') {
            event.preventDefault()
            zoomAt(1)
          }
        }}
      >
        <div className="image-stage-content" style={{ minWidth: width, minHeight: height }}>
          <div className="image-sheet" style={{ width, height }}>
            {localized && originalSrc && (
              <img
                className="image-underlay"
                src={originalSrc}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            )}
            <img
              key={src}
              ref={image}
              data-testid={testId}
              className={`image-preview ${localized ? 'localization-reveal' : ''}`}
              src={src}
              alt={alt}
              draggable={false}
              style={{ width, height }}
              onLoad={(event) =>
                setNatural({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight
                })
              }
            />
            {scanning && (
              <div className="image-scan-overlay" data-testid="image-scan" aria-hidden="true">
                <span />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="image-viewport-tools" role="group" aria-label="图像显示比例">
        <button
          type="button"
          aria-label="缩小图片"
          disabled={scale <= 0.101}
          onClick={() => zoomAt(scale / 1.25)}
        >
          <Minus size={14} />
        </button>
        <output aria-label="当前预览比例">{Math.round(scale * 100)}%</output>
        <button
          type="button"
          aria-label="放大图片"
          disabled={scale >= 7.999}
          onClick={() => zoomAt(scale * 1.25)}
        >
          <Plus size={14} />
        </button>
        <span className="viewport-tool-divider" aria-hidden="true" />
        <button type="button" aria-pressed={mode === 'fit'} onClick={fit} title="适应窗口 (0)">
          <Maximize2 size={13} />
          适应窗口
        </button>
        <button
          type="button"
          aria-pressed={mode === 'actual'}
          onClick={() => zoomAt(1)}
          title="预览像素 100% (1)"
        >
          100%
        </button>
      </div>
    </div>
  )
}
