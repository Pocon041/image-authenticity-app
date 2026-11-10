import {
  ClipboardPaste,
  FolderOpen,
  FileImage,
  ImagePlus,
  LoaderCircle,
  Maximize2,
  ScanLine,
  X
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'
import { ImageViewport } from './ImageViewport'
import '../image-results.css'

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

export function ImagePanel({ workspace: w }: { workspace: AnalysisWorkspace }) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewDialog = useRef<HTMLDialogElement>(null)
  const selection = w.imageView
  const report = !w.running && w.report?.imageId === w.image?.id ? w.report : null
  const localizations =
    report?.workflow?.detectors
      .filter((d) => d.status === 'completed' && d.localization?.overlayDataUrl)
      .map((d) => ({
        key: d.backend,
        label: d.backend === 'rise' ? 'RiSE' : 'RITA',
        src: d.localization!.overlayDataUrl
      })) ??
    (report?.localization && (report.backend === 'rita' || report.backend === 'rise')
      ? [
          {
            key: report.backend,
            label: report.backend === 'rise' ? 'RiSE' : 'RITA',
            src: report.localization.overlayDataUrl
          }
        ]
      : [])
  const initialView =
    localizations.find((item) => item.key === report?.workflow?.primary)?.key ??
    localizations[0]?.key ??
    'original'
  const view = selection?.taskId === report?.id ? selection?.view : initialView
  const displayed = localizations.find((item) => item.key === view)
  const previewSrc = displayed?.src ?? w.image?.dataUrl ?? ''
  useEffect(() => {
    setPreviewOpen(false)
  }, [w.image?.id])
  useEffect(() => {
    if (previewOpen) previewDialog.current?.showModal()
  }, [previewOpen])
  const labels = {
    workflow: ['开始分析', '重新分析', '分析中…'],
    mock: ['开始模拟分析', '重新模拟分析', '模拟分析中…'],
    rita: ['开始 RITA 定位', '重新运行 RITA', 'RITA 分析中…'],
    sica: ['开始 SICA 二分类', '重新运行 SICA', 'SICA 分类中…'],
    rise: ['开始 RiSE 定位', '重新运行 RiSE', 'RiSE 分析中…'],
    aigc: ['开始 FSD 检测', '重新运行 FSD', 'FSD 检测中…']
  }[w.backend]
  return (
    <section className="panel image-panel" aria-label="图片工作区" aria-busy={w.running}>
      <div className="panel-heading image-heading">
        <div className="image-heading-label">
          <FileImage size={18} />
          <h2>图像工作区</h2>
        </div>
        <span className="image-heading-status" aria-live="polite">
          {w.status === 'picking' ? (
            '读取中…'
          ) : w.viewingHistory && report ? (
            <time
              dateTime={report.createdAt}
              title={new Date(report.createdAt).toLocaleString('zh-CN')}
            >
              历史记录 ·{' '}
              {new Date(report.createdAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </time>
          ) : w.image ? (
            '1 张图片'
          ) : (
            '等待导入'
          )}
        </span>
        <div className="image-import-actions" role="group" aria-label="图片操作">
          <button
            className="toolbar-button"
            disabled={w.busy}
            onClick={w.chooseImage}
            title="打开图片 (Ctrl+O)"
          >
            <FolderOpen size={15} />
            {w.image ? '更换图片' : '打开图片'}
          </button>
          <button
            className="icon-button"
            disabled={w.busy}
            onClick={w.pasteImage}
            aria-label="粘贴图片"
            title="粘贴图片 (Ctrl+V)"
          >
            <ClipboardPaste size={16} />
          </button>
        </div>
      </div>
      {report && localizations.length > 0 && (
        <div
          className="image-result-tabs"
          role="group"
          aria-label="左侧图片视图"
          data-testid="image-result-views"
        >
          <button
            type="button"
            aria-pressed={!displayed}
            onClick={() => w.selectImageView('original')}
          >
            原图
          </button>
          {localizations.map((item) => (
            <button
              type="button"
              key={item.key}
              aria-pressed={view === item.key}
              onClick={() => w.selectImageView(item.key)}
            >
              {item.label} 定位
            </button>
          ))}
        </div>
      )}
      <div className={`preview-area ${w.image ? 'has-image' : ''}`}>
        {w.image ? (
          <ImageViewport
            key={w.image.id}
            src={previewSrc}
            originalSrc={w.image.dataUrl}
            scanning={w.running}
            localized={!!displayed}
            alt={
              displayed ? `${displayed.label} 定位结果：${w.image.name}` : `已导入：${w.image.name}`
            }
          />
        ) : (
          <div className="empty-upload">
            <div className="upload-symbol">
              <ImagePlus size={35} strokeWidth={1.4} />
            </div>
            <button
              className="primary-button import-button"
              onClick={w.chooseImage}
              disabled={w.busy}
            >
              <ImagePlus size={17} />
              选择图片
            </button>
            <small>拖入图片，或使用 Ctrl+V 粘贴</small>
            <small>PNG / JPG / WebP，最大 20 MB</small>
          </div>
        )}
        {w.image && (
          <button
            type="button"
            className="preview-label preview-open-button"
            onClick={() => setPreviewOpen(true)}
            aria-label="放大查看图像预览"
          >
            <Maximize2 size={13} />
            放大查看
          </button>
        )}
      </div>
      {w.image && previewOpen && (
        <dialog
          ref={previewDialog}
          className="image-preview-modal"
          aria-label={`图像预览：${w.image.name}`}
          onClose={() => setPreviewOpen(false)}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) previewDialog.current?.close()
          }}
        >
          <section className="image-preview-dialog">
            <header>
              <strong title={w.image.name}>{w.image.name}</strong>
              <button
                type="button"
                aria-label="关闭图像预览"
                onClick={() => previewDialog.current?.close()}
              >
                <X size={20} />
              </button>
            </header>
            <div className="expanded-image-canvas">
              <ImageViewport
                src={previewSrc}
                alt={`放大预览：${displayed?.label ?? '原图'} · ${w.image.name}`}
                scanning={w.running}
                testId="expanded-image-preview"
              />
            </div>
          </section>
        </dialog>
      )}
      {w.image ? (
        <div className="image-details">
          <div className="file-title">
            <FileImage size={19} />
            <strong title={w.image.name} data-testid="image-name">
              {w.image.name}
            </strong>
            <button aria-label="清空图片" disabled={w.busy} onClick={w.clearImage}>
              <X size={16} />
            </button>
          </div>
          <div className="metadata">
            <div>
              <span>分辨率</span>
              <strong>
                {w.image.width} × {w.image.height}
              </strong>
            </div>
            <div>
              <span>文件大小</span>
              <strong>{formatSize(w.image.size)}</strong>
            </div>
            <div>
              <span>图像格式</span>
              <strong>{w.image.mimeType.split('/')[1].toUpperCase()}</strong>
            </div>
          </div>
        </div>
      ) : null}
      <div className="image-controls">
        {w.backend === 'workflow' && (
          <div className="simple-content-type">
            <label htmlFor="content-type">图片类型</label>
            <select
              id="content-type"
              value={w.contentType}
              disabled={w.busy}
              onChange={(event) =>
                w.selectContentType(event.target.value as 'auto' | 'photo' | 'document' | 'unsure')
              }
            >
              <option value="auto">自动识别</option>
              <option value="photo">普通照片</option>
              <option value="document">文档 / 票据 / 截图</option>
              <option value="unsure">不确定 / 混合内容</option>
            </select>
          </div>
        )}
        <div className="image-actions">
          <button
            data-testid="analyze-button"
            className="primary-button"
            onClick={w.analyze}
            disabled={!w.image || w.busy}
          >
            {w.running ? <LoaderCircle size={17} className="spin" /> : <ScanLine size={17} />}
            {w.running ? labels[2] : w.report ? labels[1] : labels[0]}
          </button>
        </div>
      </div>
    </section>
  )
}
