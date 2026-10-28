import { useEffect, useState } from 'react'
import { CheckCircle2, FileJson, Info, Layers, ScanLine, TriangleAlert } from 'lucide-react'
import type { AnalysisReport, DetectorBackend } from '../../../shared/contracts'

const names = { sica: 'SICA', rita: 'RITA', rise: 'RiSE' }

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
  useEffect(() => {
    setSelected(initial)
    setView('overlay')
  }, [report.id])
  const active = available.find((item) => item.backend === selected) ?? available[0]
  const screening = workflow.detectors.find((item) => item.backend === 'sica')
  const classification = screening?.classification
  const canSupplement = workflow.detectors.some((item) => item.status !== 'completed')
  return (
    <div className="workflow-report" data-testid="analysis-report">
      <div className="workflow-result-heading">
        {workflow.status === 'completed' ? <CheckCircle2 size={22} /> : <TriangleAlert size={22} />}
        <div>
          <h3>{report.title}</h3>
          <p>
            {(report.elapsedMs / 1000).toFixed(1)} 秒 ·{' '}
            {workflow.status === 'completed'
              ? '计划检查已完成'
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
          .filter((item) => item.backend !== 'sica' && item.status === 'completed')
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
