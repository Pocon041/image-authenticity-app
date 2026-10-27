import { Check, CheckCircle2, Info, LoaderCircle, ScanLine } from 'lucide-react'
import type { AnalysisReport } from '../../../shared/contracts'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'

function ReportContent({ report }: { report: AnalysisReport }) {
  return (
    <div data-testid="analysis-report" className="report">
      <div className="report-title">
        <CheckCircle2 size={21} />
        <div>
          <h3>{report.title}</h3>
          <span>
            耗时 {(report.elapsedMs / 1000).toFixed(1)} 秒 ·{' '}
            {report.mode === 'local' ? '本地 RITA 推理' : '本地模拟服务'}
          </span>
        </div>
      </div>
      <div className="summary">
        <span className="small-label">描述摘要</span>
        <p>{report.summary}</p>
      </div>
      <div className="report-sections">
        {report.sections.map((section, index) => (
          <div className="report-section" key={section.title}>
            <span className="section-index">0{index + 1}</span>
            <div>
              <h4>
                {section.title}
                <span>{report.mode === 'local' ? '本地' : '模拟'}</span>
              </h4>
              <p>{section.description}</p>
            </div>
          </div>
        ))}
      </div>
      {report.localization && (
        <div className="localization-result">
          <h4>模型标记区域叠加</h4>
          <img
            data-testid="rita-overlay"
            src={report.localization.overlayDataUrl}
            alt="RITA 预测掩码的红色叠加图，非数据集标注"
          />
          <p>原始响应分数：{report.localization.score?.toFixed(4) ?? '不可用'}（未经校准）</p>
          <p>
            整图判断：
            {report.localization.decision === 'inconclusive'
              ? '证据不足 / 阈值未验证'
              : report.localization.decision === 'suspicious'
                ? '可疑（配置阈值）'
                : '未检出异常（配置阈值）'}
          </p>
          <details>
            <summary>查看 JSON 报告</summary>
            <pre data-testid="rita-bundle">
              {JSON.stringify(report.localization.bundle, null, 2)}
            </pre>
          </details>
          <p className="bundle-path">结果与附件已保存在：{report.localization.bundlePath}</p>
        </div>
      )}
      <div className="report-disclaimer">
        <Info size={15} />
        <p>{report.disclaimer}</p>
      </div>
    </div>
  )
}

export function AnalysisPanel({ workspace: w }: { workspace: AnalysisWorkspace }) {
  return (
    <section className="panel result-panel" aria-label="分析描述" aria-busy={w.running}>
      <div className="panel-heading">
        <div>
          <ScanLine size={18} />
          <h2>分析描述</h2>
        </div>
        <span className={`result-status ${w.report ? 'done' : ''}`}>
          {w.report
            ? `已完成 · ${w.report.mode === 'local' ? 'RITA' : '模拟'}`
            : w.running
              ? '处理中'
              : '待开始'}
        </span>
      </div>
      <div className="result-content" aria-live="polite">
        {w.running ? (
          <div className="result-empty">
            <div className="result-icon">
              <LoaderCircle size={32} className="spin" />
            </div>
            <h3>{w.backend === 'rita' ? '正在运行 RITA' : '正在运行模拟流程'}</h3>
            <p data-testid="analysis-progress-label">
              {w.progress?.label ?? (w.backend === 'rita' ? '准备本地推理任务' : '准备模拟任务')}
            </p>
            <div
              className="loading-track"
              role="progressbar"
              aria-label={w.backend === 'rita' ? 'RITA 任务进度' : '模拟任务进度'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={w.progress?.percent ?? 0}
            >
              <span style={{ width: `${w.progress?.percent ?? 0}%` }} />
            </div>
            <small>
              {w.backend === 'rita'
                ? '进度来自本地推理进程，可以取消任务'
                : '进度来自本地模拟服务，没有调用模型'}
            </small>
            <button
              className="secondary-button cancel-button"
              disabled={w.status === 'cancelling'}
              onClick={w.cancel}
            >
              {w.status === 'cancelling' ? '正在取消…' : '取消分析'}
            </button>
          </div>
        ) : w.report ? (
          <ReportContent report={w.report} />
        ) : (
          <div className="result-empty">
            <div className="result-icon">
              <ScanLine size={34} strokeWidth={1.4} />
            </div>
            <h3>{w.image ? '图片已就绪' : '等待第一张图片'}</h3>
            <p>
              {w.backend === 'rita'
                ? '选择图片后启动本地 RITA 定位。\n需要配置 Python 和官方权重。'
                : w.image
                  ? '点击「开始模拟分析」，\n查看完整的描述展示效果。'
                  : '导入图片并开始模拟分析后，\n分析描述将在这里展示。'}
            </p>
            <div className="capability-list">
              <span>
                <Check size={13} />
                AI 生成检测展示位
              </span>
              <span>
                <Check size={13} />
                局部篡改定位展示位
              </span>
              <span>
                <Check size={13} />
                自然语言描述展示位
              </span>
            </div>
            <small>
              {w.backend === 'rita'
                ? '此模式仅运行篡改定位，其他模块未执行'
                : '以上能力当前均未接入模型'}
            </small>
          </div>
        )}
      </div>
    </section>
  )
}
