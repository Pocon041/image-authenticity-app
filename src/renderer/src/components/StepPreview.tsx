import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Expand, X } from 'lucide-react'
import type { LocalizationPreview } from '../../../shared/contracts'

export function StepPreview({
  preview,
  name,
  original
}: {
  preview: LocalizationPreview
  name: string
  original: string
}) {
  const [view, setView] = useState<'overlay' | 'original'>('overlay')
  const [expanded, setExpanded] = useState(false)
  const [actualSize, setActualSize] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (expanded) dialog.current?.showModal()
  }, [expanded])
  const src = view === 'overlay' ? preview.overlayDataUrl : original
  const controls = (
    <>
      <button type="button" aria-pressed={view === 'overlay'} onClick={() => setView('overlay')}>
        定位叠加
      </button>
      <button type="button" aria-pressed={view === 'original'} onClick={() => setView('original')}>
        原图
      </button>
    </>
  )
  return (
    <details className="step-preview" data-testid={`step-preview-${name.toLowerCase()}`}>
      <summary>
        {name} · 查看定位结果 <span>{preview.regionCount} 处标记</span>
      </summary>
      <div className="step-preview-content">
        <div className="step-preview-toolbar" role="group" aria-label={`${name}预览方式`}>
          {controls}
          <span>标记面积 {(preview.manipulatedAreaFraction * 100).toFixed(1)}%</span>
        </div>
        <button
          className="step-preview-enlarge"
          type="button"
          aria-label={`放大 ${name} 定位结果`}
          onClick={() => {
            setActualSize(false)
            setExpanded(true)
          }}
        >
          <img src={src} alt={`${name}${view === 'overlay' ? '定位叠加' : '原图'}`} />
          <span>
            <Expand size={13} />
            放大查看
          </span>
        </button>
        <p>着色部分为检测器标记，保留各模型独立结果。</p>
      </div>
      {expanded &&
        createPortal(
          <dialog
            ref={dialog}
            className="step-preview-dialog"
            aria-label={`${name}定位大图`}
            onClose={() => setExpanded(false)}
            onClick={(event) => {
              if (event.target === event.currentTarget) dialog.current?.close()
            }}
          >
            <header>
              <strong>{name} · 定位结果</strong>
              <button
                type="button"
                aria-label="关闭定位大图"
                onClick={() => dialog.current?.close()}
              >
                <X size={18} />
              </button>
            </header>
            <div className="step-preview-toolbar" role="group" aria-label="大图显示方式">
              {controls}
              <button
                type="button"
                aria-pressed={actualSize}
                onClick={() => setActualSize((value) => !value)}
              >
                {actualSize ? '适应窗口' : '原始比例'}
              </button>
            </div>
            <div className={`step-preview-viewport ${actualSize ? 'actual-size' : ''}`}>
              <img src={src} alt={`${name}定位结果大图`} />
            </div>
          </dialog>,
          document.body
        )}
    </details>
  )
}
