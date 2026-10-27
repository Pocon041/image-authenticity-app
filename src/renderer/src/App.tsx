import { Check, FlaskConical, Info, X } from 'lucide-react'
import { AnalysisPanel } from './components/AnalysisPanel'
import { ImagePanel } from './components/ImagePanel'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { useAnalysisWorkspace } from './hooks/useAnalysisWorkspace'

export function App() {
  const workspace = useAnalysisWorkspace()
  const local = workspace.backend === 'rita'
  const steps = [
    { number: '01', label: '导入图片', complete: !!workspace.image },
    { number: '02', label: local ? 'RITA 定位' : '模拟分析', complete: !!workspace.report },
    { number: '03', label: '查看描述', complete: !!workspace.report }
  ]

  return (
    <WorkspaceLayout>
      <div className="page-heading">
        <div>
          <div className="eyebrow">IMAGE AUTHENTICITY WORKSPACE</div>
          <h1>从一张图片开始</h1>
          <p>导入图像，体验完整的分析与描述流程。</p>
        </div>
        <div className="mode-badge">
          <FlaskConical size={15} />
          {local ? 'RITA 本地定位' : '模拟分析模式'}
        </div>
      </div>
      <div className="demo-notice">
        <Info size={17} />
        <span>
          {local
            ? 'RITA 模式使用本机官方权重，未配置时会提示错误；此模式不执行 AI 检测或 VLM，整图阈值仍需验证。'
            : '当前为 Smoke 测试版本。所有分析描述均为模拟内容，未接入检测模型或语言模型。'}
        </span>
      </div>
      <div className="backend-picker" role="group" aria-label="分析服务">
        <button
          aria-pressed={!local}
          disabled={workspace.busy}
          onClick={() => workspace.selectBackend('mock')}
        >
          模拟流程
        </button>
        <button
          aria-pressed={local}
          disabled={workspace.busy}
          onClick={() => workspace.selectBackend('rita')}
        >
          RITA 本地定位
        </button>
      </div>
      <div className="steps" aria-label="分析流程">
        {steps.map((step, index) => (
          <div key={step.number} className={`step ${step.complete ? 'complete' : ''}`}>
            <span className="step-number">{step.complete ? <Check size={14} /> : step.number}</span>
            <span>{step.label}</span>
            {index < 2 && <div className="step-line" />}
          </div>
        ))}
      </div>
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
      <div className="analysis-grid">
        <ImagePanel workspace={workspace} />
        <AnalysisPanel workspace={workspace} />
      </div>
    </WorkspaceLayout>
  )
}
