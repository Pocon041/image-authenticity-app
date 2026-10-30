import { useEffect, useState } from 'react'
import { CheckCircle2, FileJson, Info, Layers, Loader2, MessageSquareText, ScanLine, TriangleAlert } from 'lucide-react'
import type { AnalysisReport, DetectorBackend } from '../../../shared/contracts'
import type { ExplanationReport } from '../../../shared/protocol'
import { ProvenanceSummary } from './ProvenanceSummary'

const names = { aigc: 'FSD', sica: 'SICA', rita: 'RITA', rise: 'RiSE' }

export function WorkflowReport({
  report,
  originalDataUrl,
  onSupplement
}: {
  report: AnalysisReport
  originalDataUrl: string
  onSupplement(): void
}) {
  const workflow = report.workflow!
  const available = workflow.detectors.filter(
    (item) => item.status === 'completed' && item.localization
  )
  const initial =
    available.find((item) => item.backend === workflow.primary)?.backend ??
    available[0]?.backend ??
    'rita'
  const [selected, setSelected] = useState<DetectorBackend>(initial)
  const [view, setView] = useState<'overlay' | 'original'>('overlay')
  const [folderError, setFolderError] = useState('')
  
  // 第四人：解释生成相关状态
  const [explaining, setExplaining] = useState(false)
  const [explanation, setExplanation] = useState<ExplanationReport | null>(null)
  const [explainError, setExplainError] = useState('')

  useEffect(() => {
    setSelected(initial)
    setView('overlay')
    // 切换图片时重置解释状态
    setExplanation(null)
    setExplainError('')
  }, [report.id])

  const active = available.find((item) => item.backend === selected) ?? available[0]
  const screening = workflow.detectors.find((item) => item.backend === 'sica')
  const classification = screening?.classification
  const aigc = workflow.detectors.find((item) => item.backend === 'aigc')
  const canSupplement = workflow.detectors.some((item) => item.status !== 'completed')

  // 第四人：触发解释生成
  const handleExplain = async () => {
    setExplaining(true)
    setExplainError('')
    try {
      const res = await window.desktop.explain(report.id)
      if (res.ok) {
        setExplanation(res.data)
      } else {
        setExplainError(res.error)
      }
    } catch (err) {
      setExplainError(err instanceof Error ? err.message : '请求解释服务失败')
    } finally {
      setExplaining(false)
    }
  }

  return (
    <div className="workflow-report" data-testid="analysis-report">
      <div className="workflow-result-heading">
        {workflow.status === 'completed' ? <CheckCircle2 size={22} /> : <TriangleAlert size={22} />}
        <div>
          <h3>{report.title}</h3>
          <p>
            {(report.elapsedMs / 1000).toFixed(1)} 秒 ·{' '}
            {workflow.status === 'completed'
              ? '篡改检查已完成'
              : workflow.status === 'partial'
                ? '部分检查未完成'
                : '请检查检测环境'}
          </p>
        </div>
      </div>
      {workflow.flags.length > 0 && (
        <div className="workflow-flags" data-testid="workflow-flags">
          <TriangleAlert size={17} />
          <div>
            {workflow.flags.map((flag) => (
              <p key={flag}>{flag}</p>
            ))}
          </div>
        </div>
      )}
      {/* [第三人任务] FSD 检测结果先于原有整图筛查与局部定位展示。 */}
      <section className="screening-section" aria-label="AI 生成检测">
        <div className="section-label">
          <ScanLine size={15} />
          <h4>AI 生成检测</h4>
          <span>FSD</span>
        </div>
        {aigc?.aigc ? (
          <div className="screening-answer" data-testid="workflow-aigc-result">
            <strong>{aigc.aigc.decision === 'ai_generated' ? '检测倾向 AI 生成' : aigc.aigc.decision === 'non_ai' ? '检测倾向真实图像' : '结果不确定'}</strong>
            <p>FSD z-score：{aigc.aigc.zScore.toFixed(4)}（阈值 {aigc.aigc.threshold}；不是概率）</p>
            <p>来源线索：{aigc.aigc.attributedSource ?? '未识别到受支持的生成器 / 来源未知'}</p>
            {aigc.aigc.attributionScore !== null && <p>来源分数：{aigc.aigc.attributionScore.toFixed(4)}</p>}
            <small>分数不是校准概率，不定位具体生成区域；结果可能受压缩、缩放及未知生成器影响。</small>
          </div>
        ) : (
          <p className="detector-error">FSD 检测未完成，详情请查看下方检测状态。</p>
        )}
      </section>
      <section className="screening-section" aria-label="整图筛查">
        <div className="section-label">
          <ScanLine size={15} />
          <h4>整图筛查</h4>
          <span>SICA</span>
        </div>
        {classification ? (
          <div className="screening-answer" data-testid="workflow-classification">
            {classification.decision === 'fake' ? '存在通用伪造线索' : '整图筛查倾向真实'}
          </div>
        ) : (
          <p className="detector-error">整图筛查未完成，具体原因见检测详情。</p>
        )}
      </section>
      <section className="localization-section" aria-label="局部定位">
        <div className="section-label">
          <Layers size={15} />
          <h4>局部定位</h4>
          <span>按模型分别查看</span>
        </div>
        <div className="localization-tabs" role="group" aria-label="定位来源">
        {workflow.detectors
          .filter((item) => item.backend !== 'sica' && item.backend !== 'aigc' && item.status === 'completed')
            .map((item) => (
              <button
                key={item.backend}
                disabled={item.status !== 'completed'}
                aria-pressed={active?.backend === item.backend}
                onClick={() => setSelected(item.backend)}
                data-testid={`localizer-${item.backend}`}
              >
                {names[item.backend]}
                <span>
                  {item.status === 'not_run'
                    ? '未安排'
                    : item.status === 'failed'
                      ? '未完成'
                      : `${item.localization?.regionCount ?? 0} 个区域`}
                </span>
              </button>
            ))}
        </div>
        {active?.localization ? (
          <>
            <div className="viewer-toolbar">
              <span>
                {names[active.backend]} · 标记面积{' '}
                {(active.localization.manipulatedAreaFraction * 100).toFixed(2)}%
              </span>
              <div>
                <button aria-pressed={view === 'overlay'} onClick={() => setView('overlay')}>
                  叠加定位
                </button>
                <button aria-pressed={view === 'original'} onClick={() => setView('original')}>
                  原图
                </button>
              </div>
            </div>
            <div className="evidence-viewer">
              <img
                data-testid="workflow-overlay"
                src={view === 'overlay' ? active.localization.overlayDataUrl : originalDataUrl}
                alt={`${names[active.backend]} ${view === 'overlay' ? '模型预测区域叠加，非人工真值' : '原图预览'}`}
              />
            </div>
            <p className="viewer-caption">
              {active.localization.regionCount
                ? '着色区域为模型响应，可能包含误标。切换原图核对，或查看下方区域裁剪。'
                : '该定位器本次未标记区域，不能据此确认图片真实。'}
            </p>
            {!!active.regionPreviews?.length && (
              <details className="region-details">
                <summary>查看区域裁剪（{active.regionPreviews.length}）</summary>
                <div className="region-grid">
                  {active.regionPreviews.map((region, index) => (
                    <div className="region-preview" key={region.regionId}>
                      <img src={region.dataUrl} alt={`区域 ${index + 1} 的原图裁剪`} />
                      <strong>区域 {index + 1}</strong>
                      <small>
                        位置 {region.bboxXYWH[0]}, {region.bboxXYWH[1]} · {region.bboxXYWH[2]}×
                        {region.bboxXYWH[3]} 像素
                      </small>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </>
        ) : (
          <div className="localization-unavailable">
            <Info size={20} />
            <p>没有已完成的定位结果。请查看各模型状态；失败不等于未检出。</p>
          </div>
        )}
        {canSupplement && (
          <button
            className="secondary-button supplement-button"
            onClick={onSupplement}
            data-testid="supplement-button"
          >
            {workflow.status === 'completed' ? '补充检查' : '重试 / 补充检查'}
          </button>
        )}
      </section>
      
      <ProvenanceSummary bundle={workflow.bundle} />

      {/* 第四人：综合解释生成区块 */}
      <section className="explanation-section" aria-label="综合解释" style={{ marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #eee' }}>
        <div className="section-label">
          <MessageSquareText size={15} />
          <h4>综合解释分析</h4>
        </div>
        
        {!explanation && !explaining && (
          <div style={{ marginTop: '10px' }}>
            <p style={{ fontSize: '0.9em', color: '#666', marginBottom: '10px' }}>
              基于上述视觉检测和来源证据，由本地 VLM 模型生成易懂的综合判断。
            </p>
            <button className="primary-button" onClick={handleExplain} data-testid="explain-button">
              生成智能解释
            </button>
          </div>
        )}

        {explaining && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', color: '#0055ff' }}>
            <Loader2 className="spin" size={18} />
            <span>正在调用本地 VLM 模型生成解释，请稍候（最长约需两分钟）...</span>
          </div>
        )}

        {explainError && (
          <div className="workflow-flags" style={{ marginTop: '10px' }}>
            <TriangleAlert size={17} />
            <p>{explainError}</p>
          </div>
        )}

                {explanation?.result && (
          <div className="explanation-result" style={{ marginTop: '10px', background: '#2a2a35', padding: '15px', borderRadius: '8px', border: '1px solid #3f3f4e' }}>
            {/* 如果是兜底模式，给出提示 */}
            {explanation.mode === 'mock' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f5a623', fontSize: '0.85em', marginBottom: '12px' }}>
                <TriangleAlert size={14} />
                <span>VLM 连接失败或输出校验未通过，以下为本地规则引擎生成的保底解释。</span>
              </div>
            )}
            
            <div style={{ marginBottom: '15px' }}>
              <strong style={{ color: '#fff' }}>最终判定：</strong>
              <span style={{ 
                marginLeft: '8px', 
                padding: '2px 10px', 
                borderRadius: '4px', 
                color: '#000', // 文字强制黑色以便在亮色背景上显示
                fontWeight: 'bold',
                background: explanation.result.finalDecision === 'suspicious' ? '#f5a623' : explanation.result.finalDecision === 'no_anomaly_detected' ? '#4caf50' : '#9e9e9e'
              }}>
                {explanation.result.finalDecision === 'suspicious' ? '可疑 / 疑似伪造' : explanation.result.finalDecision === 'no_anomaly_detected' ? '未发现异常' : '无法确定 (Inconclusive)'}
              </span>
            </div>

            <p style={{ lineHeight: '1.6', marginBottom: '15px', color: '#e0e0e0' }}>{explanation.result.analysis}</p>

            {explanation.result.claims.length > 0 && (
              <div style={{ marginBottom: '15px' }}>
                <strong style={{ color: '#fff' }}>证据支撑：</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '5px', fontSize: '0.9em', color: '#b0b0b0' }}>
                  {explanation.result.claims.map((claim, idx) => (
                    <li key={idx}>
                      {claim.text}
                      <span style={{ color: '#888', fontSize: '0.85em', marginLeft: '6px' }}>({claim.evidenceIds.join(', ')})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {explanation.result.unresolved.length > 0 && (
              <div>
                <strong style={{ color: '#ff6b6b' }}>未解决 / 缺失的信息：</strong>
                <ul style={{ paddingLeft: '20px', marginTop: '5px', fontSize: '0.9em', color: '#b0b0b0' }}>
                  {explanation.result.unresolved.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <details className="detector-details">
        <summary>检测详情</summary>
        {classification && (
          <p>
            整图伪造分数 {classification.score.toFixed(4)}，阈值 {classification.threshold}
            ，未经校准。
          </p>
        )}
        <ul>
          {workflow.detectors.map((item) => (
            <li key={item.backend}>
              <strong>{names[item.backend]}</strong>
              <span>
                {item.status === 'completed'
                  ? item.reused
                    ? '已复用'
                    : '已完成'
                  : item.status === 'failed'
                    ? '失败'
                    : '未安排'}
                {item.status === 'completed' && ` · ${(item.elapsedMs / 1000).toFixed(1)} 秒`}
              </span>
              {item.error && <p>{item.error.message}</p>}
            </li>
          ))}
        </ul>
        <p className="bundle-path">完整记录：{workflow.bundlePath}</p>
      </details>
      <details className="bundle-details">
        <summary>
          <FileJson size={15} /> 查看 JSON 报告
        </summary>
        <pre data-testid="workflow-summary-json">{JSON.stringify(workflow.summary, null, 2)}</pre>
        <pre data-testid="workflow-bundle" hidden>
          {JSON.stringify(workflow.bundle)}
        </pre>
        <p className="bundle-path">{workflow.summaryPath}</p>
      </details>
      <button
        className="secondary-button report-folder-button"
        onClick={async () => {
          const result = await window.desktop.openReportDirectory(report.id)
          setFolderError(result.ok ? '' : result.error)
        }}
      >
        打开报告文件夹
      </button>
      {folderError && <p role="alert">{folderError}</p>}
      <div className="report-disclaimer">
        <Info size={15} />
        <p>{report.disclaimer}</p>
      </div>
    </div>
  )
}