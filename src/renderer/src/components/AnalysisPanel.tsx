import { Check, CheckCircle2, Info, LoaderCircle, ScanLine } from 'lucide-react'
import type { AnalysisBackend, AnalysisReport } from '../../../shared/contracts'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'
import { WorkflowReport } from './WorkflowReport'

function backendName(backend?: AnalysisBackend): string {
  return backend === 'workflow'
    ? '联合分析'
    : backend === 'rise'
      ? 'RiSE'
      : backend === 'sica'
        ? 'SICA'
        : backend === 'rita'
          ? 'RITA'
          : backend === 'aigc'
            ? 'FSD AIGC'
          : '模拟'
}

function ReportContent({ report }: { report: AnalysisReport }) {
  const rise = report.backend === 'rise'
  return (
    <div data-testid="analysis-report" className="report">
      <div className="report-title">
        <CheckCircle2 size={21} />
        <div>
          <h3>{report.title}</h3>
          <span>
            耗时 {(report.elapsedMs / 1000).toFixed(1)} 秒 ·{' '}
          {report.backend === 'aigc'
            ? '本地 FSD AI 生成检测'
            : report.mode === 'local'
              ? rise
                ? '本地 RiSE 文档定位'
                : report.backend === 'sica'
                  ? '本地 SICA 分类'
                  : '本地 RITA 推理'
              : '本地模拟服务'}
          </span>
        </div>
      </div>
      {report.classification && (
        <div className="localization-result" data-testid="sica-classification">
          <h4>图像级二分类结果</h4>
          <p>
            模型判断：
            {report.classification.decision === 'fake'
              ? '疑似伪造（未区分生成或篡改）'
              : '倾向真实（不等同于真实性证明）'}
          </p>
          <p>伪造分数：{report.classification.score.toFixed(6)}（未经校准）</p>
          <p>分类阈值：{report.classification.threshold}；本次未生成定位掩码。</p>
          {report.classification.checkpointVariant === 'full' && (
            <p>当前使用 full 权重，可能见过相关数据；此结果不作为独立泛化评测。</p>
          )}
          <details>
            <summary>查看 SICA JSON 报告</summary>
            <pre data-testid="sica-bundle">
              {JSON.stringify(report.classification.bundle, null, 2)}
            </pre>
          </details>
          <p className="bundle-path">报告保存于：{report.classification.bundlePath}</p>
        </div>
      )}
      {report.aigc && (
        <div className="localization-result" data-testid="aigc-result">
          <h4>AI 生成检测 · FSD</h4>
          <p>模型判断：{report.aigc.decision === 'ai_generated' ? '检测倾向 AI 生成' : report.aigc.decision === 'non_ai' ? '检测倾向真实图像' : '结果不确定'}</p>
          <p>FSD z-score：{report.aigc.zScore.toFixed(4)}（判定阈值 {report.aigc.threshold}；不是概率）</p>
          <p>生成来源线索：{report.aigc.attributedSource ?? '未识别到受支持的生成器 / 来源未知'}</p>
          {report.aigc.attributionScore !== null && <p>来源匹配分数：{report.aigc.attributionScore.toFixed(4)}（未经本项目校准）</p>}
          <p>该分数反映模型取证残差特征，不定位具体生成区域；压缩、缩放或未知生成器可能影响结果。</p>
          <details><summary>查看 FSD JSON 报告</summary><pre>{JSON.stringify(report.aigc.bundle, null, 2)}</pre></details>
          <p className="bundle-path">报告保存于：{report.aigc.bundlePath}</p>
        </div>
      )}
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
            data-testid={rise ? 'rise-overlay' : 'rita-overlay'}
            src={report.localization.overlayDataUrl}
            alt={
              rise
                ? 'RiSE 预测掩码的红色叠加图，非人工标注'
                : 'RITA 预测掩码的红色叠加图，非数据集标注'
            }
          />
          <p>
            定位输出：
            {report.localization.regionCount > 0
              ? `模型标记了 ${report.localization.regionCount} 个可疑区域`
              : '本次未标记可疑区域（不等同于确认真实）'}
          </p>
          <p>像素响应统计：{report.localization.score?.toFixed(4) ?? '不可用'}（非整图置信度）</p>
          <p>
            图像级分类：
            {report.localization.decision === 'inconclusive'
              ? report.localization.score === null
                ? '未输出结论（未获得有效响应或阈值未配置）'
                : '未输出结论（尚未配置经验证的阈值）'
              : report.localization.decision === 'suspicious'
                ? '可疑（配置阈值）'
                : '未检出异常（配置阈值）'}
          </p>
          <details>
            <summary>查看 JSON 报告</summary>
            <pre data-testid={rise ? 'rise-bundle' : 'rita-bundle'}>
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
  const modelName = backendName(w.backend)
  const local = w.backend !== 'mock'
  return (
    <section className="panel result-panel" aria-label="分析描述" aria-busy={w.running}>
      <div className="panel-heading">
        <div>
          <ScanLine size={18} />
          <h2>{w.backend === 'workflow' ? '分析与证据' : '分析描述'}</h2>
        </div>
        <span className={`result-status ${w.report ? 'done' : ''}`}>
          {w.report
            ? `已完成 · ${w.report.mode === 'local' ? backendName(w.report.backend) : '模拟'}`
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
            <h3>{local ? `正在运行 ${modelName}` : '正在运行模拟流程'}</h3>
            <p data-testid="analysis-progress-label">
              {w.progress?.label ?? (local ? '准备本地推理任务' : '准备模拟任务')}
            </p>
            <div
              className="loading-track"
              role="progressbar"
              aria-label={local ? `${modelName} 任务进度` : '模拟任务进度'}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={w.progress?.percent ?? 0}
            >
              <span style={{ width: `${w.progress?.percent ?? 0}%` }} />
            </div>
            <small>
              {local ? '进度来自本地推理进程，可以取消任务' : '进度来自本地模拟服务，没有调用模型'}
            </small>
            {w.progress?.steps && (
              <ol className="workflow-progress" data-testid="workflow-progress">
                {w.progress.steps.map((step) => (
                  <li key={step.backend} data-status={step.status}>
                    <span>
                      {step.backend === 'sica'
                        ? 'SICA · 整图筛查'
                        : step.backend === 'aigc'
                          ? 'FSD · AI 生成检测'
                        : step.backend === 'rita'
                          ? 'RITA · 图像定位'
                          : 'RiSE · 文档定位'}
                    </span>
                    <strong>
                      {
                        {
                          pending: '等待',
                          running: '运行中',
                          completed: '完成',
                          failed: '未完成',
                          not_run: '未安排',
                          reused: '复用证据',
                          cancelled: '已取消'
                        }[step.status]
                      }
                    </strong>
                  </li>
                ))}
              </ol>
            )}
            <button
              className="secondary-button cancel-button"
              disabled={w.status === 'cancelling'}
              onClick={w.cancel}
            >
              {w.status === 'cancelling' ? '正在取消…' : '取消分析'}
            </button>
          </div>
        ) : w.report?.workflow ? (
          <WorkflowReport
            report={w.report}
            originalDataUrl={w.image?.dataUrl ?? ''}
            onSupplement={w.supplement}
          />
        ) : w.report ? (
          <ReportContent report={w.report} />
        ) : (
          <div className="result-empty">
            <div className="result-icon">
              <ScanLine size={34} strokeWidth={1.4} />
            </div>
            <h3>{w.image ? '图片已就绪' : '等待第一张图片'}</h3>
            <p>
              {w.backend === 'workflow'
                ? '选择图片与内容类型后开始分析。\n整图筛查与定位结果将分别呈现。'
                : w.backend === 'rise'
                  ? '选择图片后运行 RiSE 文档定位。\n将自动分块覆盖整张图片。'
                  : w.backend === 'sica'
                    ? '选择图片后运行 SICA 二分类。\n需要配置 Python 和官方权重。'
                    : w.backend === 'aigc'
                      ? '此模式只运行 FSD AI 生成检测；需要配置本地 Python 与模型权重。'
                    : w.backend === 'rita'
                      ? '选择图片后启动本地 RITA 定位。\n需要配置 Python 和官方权重。'
                      : w.image
                        ? '点击「开始模拟分析」，\n查看完整的描述展示效果。'
                        : '导入图片并开始模拟分析后，\n分析描述将在这里展示。'}
            </p>
            <div className="capability-list">
              {w.backend === 'workflow' ? (
                <>
                  <span>
                    <Check size={13} />
                    独立整图筛查
                  </span>
                  <span>
                    <Check size={13} />
                    可追溯区域定位
                  </span>
                  <span>
                    <Check size={13} />
                    模型分歧保留
                  </span>
                </>
              ) : w.backend === 'aigc' ? (
                <>
                  <span><Check size={13} />AI 生成倾向检测</span>
                  <span><Check size={13} />FSD 取证分数与阈值</span>
                  <span><Check size={13} />本机生成来源归因可选</span>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
            <small>
              {w.backend === 'workflow'
                ? '可按内容选择定位方式，也可运行两种定位进行对照'
                : w.backend === 'rise'
                  ? '此模式只运行视觉定位，不执行 OCR 或 VLM'
                  : w.backend === 'sica'
                    ? '此模式只运行整图分类，不生成掩码或 VLM 解释'
                    : w.backend === 'aigc'
                      ? 'FSD 不输出生成区域；来源归因默认关闭，未知来源不会猜测。'
                    : w.backend === 'rita'
                      ? '此模式仅运行篡改定位，其他模块未执行'
                      : '以上能力当前均未接入模型'}
            </small>
          </div>
        )}
      </div>
    </section>
  )
}
