import {
  ArrowRight,
  FileImage,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  Sparkles,
  X
} from 'lucide-react'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`
}

export function ImagePanel({ workspace: w }: { workspace: AnalysisWorkspace }) {
  const labels = {
    workflow: ['开始分析', '重新分析', '分析中…'],
    mock: ['开始模拟分析', '重新模拟分析', '模拟分析中…'],
    rita: ['开始 RITA 定位', '重新运行 RITA', 'RITA 分析中…'],
    sica: ['开始 SICA 二分类', '重新运行 SICA', 'SICA 分类中…'],
    rise: ['开始 RiSE 定位', '重新运行 RiSE', 'RiSE 分析中…'],
    aigc: ['开始 FSD 检测', '重新运行 FSD', 'FSD 检测中…']
  }[w.backend]
  return (
    <section className="panel image-panel" aria-label="图片工作区">
      <div className="panel-heading">
        <div>
          <FileImage size={18} />
          <h2>图像工作区</h2>
        </div>
        <span>{w.image ? '1 张图片' : '等待导入'}</span>
      </div>
      <div className={`preview-area ${w.image ? 'has-image' : ''}`}>
        {w.image ? (
          <img
            data-testid="image-preview"
            className="image-preview"
            src={w.image.dataUrl}
            alt={`已导入：${w.image.name}`}
          />
        ) : (
          <div className="empty-upload">
            <div className="upload-symbol">
              <ImagePlus size={35} strokeWidth={1.4} />
            </div>
            <h3>选择一张待分析的图片</h3>
            <p>从本地导入，图片不会上传到服务器</p>
            <button
              className="primary-button import-button"
              onClick={w.chooseImage}
              disabled={w.busy}
            >
              <ImagePlus size={17} />
              选择图片
            </button>
            <small>PNG / JPG / WebP · 最大 20 MB</small>
          </div>
        )}
        {w.image && <span className="preview-label">图像预览</span>}
      </div>
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
      ) : (
        <div className="image-details empty-details">
          <LockKeyhole size={15} />
          <span>文件仅在本次会话中读取，不修改原图</span>
        </div>
      )}
      {w.backend === 'workflow' && (
        <div className="simple-content-type">
          <label htmlFor="content-type">图片类型</label>
          <select
            id="content-type"
            value={w.contentType}
            disabled={w.busy}
            onChange={(event) =>
              w.selectContentType(event.target.value as 'photo' | 'document' | 'unsure')
            }
          >
            <option value="photo">普通照片</option>
            <option value="document">文档 / 票据 / 截图</option>
            <option value="unsure">不确定 / 混合内容</option>
          </select>
          <small data-testid="route-plan">
            {w.contentType === 'document'
              ? '包括拍摄的小票和文字截图。'
              : w.contentType === 'photo'
                ? '适用于人物、物品和自然场景。'
                : '将运行两种定位检查，耗时稍长。'}
          </small>
        </div>
      )}
      <div className="image-actions">
        <button className="secondary-button" onClick={w.chooseImage} disabled={w.busy}>
          {w.image ? '更换图片' : '浏览文件'}
        </button>
        <button
          data-testid="analyze-button"
          className="primary-button"
          onClick={w.analyze}
          disabled={!w.image || w.busy}
        >
          {w.running ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
          {w.running ? labels[2] : w.report ? labels[1] : labels[0]}
          {!w.running && <ArrowRight size={16} />}
        </button>
      </div>
    </section>
  )
}
