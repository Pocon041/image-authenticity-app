import { Check, FlaskConical, Info, X } from 'lucide-react'
import { AnalysisPanel } from './components/AnalysisPanel'
import { ImagePanel } from './components/ImagePanel'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { useAnalysisWorkspace } from './hooks/useAnalysisWorkspace'

export function App() {
  const workspace = useAnalysisWorkspace()
  const local = workspace.backend !== 'mock'
  const sica = workspace.backend === 'sica'
  const rise = workspace.backend === 'rise'
  const aigc = workspace.backend === 'aigc'
  const workflow = workspace.backend === 'workflow'
  const steps = [
    { number: '01', label: '导入图片', complete: !!workspace.image },
    {
      number: '02',
      label: workflow
        ? '整图筛查与定位'
        : sica
          ? 'SICA 分类'
          : rise
            ? 'RiSE 定位'
            : aigc
              ? 'FSD AI 生成检测'
            : local
              ? 'RITA 定位'
              : '模拟分析',
      complete: !!workspace.report
    },
    { number: '03', label: workflow ? '查看证据' : '查看描述', complete: !!workspace.report }
  ]

  return (
    <WorkspaceLayout>
      <div className="page-heading">
        <div>
          <h1>从一张图片开始</h1>
          <p>选择图片，查看可疑区域与检测报告。</p>
        </div>
        {!workflow && (
          <div className="mode-badge">
            <FlaskConical size={15} />
            {workflow
              ? '本地联合分析'
              : aigc
                ? 'FSD AI 生成检测'
                : sica
                ? 'SICA 图像二分类'
                : rise
                  ? 'RiSE 文档定位'
                  : local
                    ? 'RITA 本地定位'
                    : '模拟分析模式'}
          </div>
        )}
      </div>
      {!workflow && (
        <div className="demo-notice">
          <Info size={17} />
          <span>
            {sica
              ? 'SICA 只给出整图真假分类，不识别伪造类型或定位区域。分数未经本项目校准，full 权重的效果记录不作独立泛化证明。'
              : rise
                ? 'RiSE 对文档执行全图分块视觉定位，显示模型标记的可疑区域；未检出不代表真实，当前不提供整图真实性结论。'
                : aigc
                  ? 'FSD 在本地判断图片的 AI 生成倾向，展示模型分数与阈值；分数不是概率，不定位具体生成区域。来源归因默认关闭，结果尚未在本项目目标图片上完成效果验证。'
                : local
                  ? 'RITA 模式使用本机官方权重，未配置时会提示错误；此模式不执行 AI 检测或 VLM，整图阈值仍需验证。'
                  : '当前为 Smoke 测试版本。所有分析描述均为模拟内容，未接入检测模型或语言模型。'}
          </span>
        </div>
      )}

      {!workflow && (
        <div className="steps" aria-label="分析流程">
          {steps.map((step, index) => (
            <div key={step.number} className={`step ${step.complete ? 'complete' : ''}`}>
              <span className="step-number">
                {step.complete ? <Check size={14} /> : step.number}
              </span>
              <span>{step.label}</span>
              {index < 2 && <div className="step-line" />}
            </div>
          ))}
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
      <div className={`analysis-grid ${workflow ? 'workflow-grid' : ''}`}>
        <ImagePanel workspace={workspace} />
        <AnalysisPanel workspace={workspace} />
      </div>
      <details className="developer-tools">
        <summary>开发与单模型调试</summary>
        <p>用于排查单个模型。日常分析请选择联合流程。</p>
        <div className="backend-picker" role="group" aria-label="分析服务">
          <button
            aria-pressed={workflow}
            disabled={workspace.busy}
            onClick={() => workspace.selectBackend('workflow')}
          >
            联合分析
          </button>
          <button
            aria-pressed={!local}
            disabled={workspace.busy}
            onClick={() => workspace.selectBackend('mock')}
          >
            模拟流程
          </button>
          <button
            aria-pressed={workspace.backend === 'rita'}
            disabled={workspace.busy}
            onClick={() => workspace.selectBackend('rita')}
          >
            RITA 本地定位
          </button>
          <button
            aria-pressed={sica}
            disabled={workspace.busy}
            onClick={() => workspace.selectBackend('sica')}
          >
            SICA 图像二分类
          </button>
          <button
            aria-pressed={rise}
            disabled={workspace.busy}
            onClick={() => workspace.selectBackend('rise')}
          >
            RiSE 文档定位
          </button>
          {/* [第三人任务] FSD 独立 AIGC 检测入口。 */}
          <button aria-pressed={workspace.backend === 'aigc'} disabled={workspace.busy} onClick={() => workspace.selectBackend('aigc')}>FSD AI 生成检测</button>
        </div>
      </details>
    </WorkspaceLayout>
  )
}
