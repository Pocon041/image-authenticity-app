import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, LoaderCircle, MessageSquareText } from 'lucide-react'
import type { Response, WorkflowStep } from '../../../shared/contracts'
import type { ExplanationReport } from '../../../shared/protocol'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'
import { WorkflowReport } from './WorkflowReport'
import '../conversation.css'

type Item = { id: string; title: string; status: WorkflowStep['status']; message?: string }
const titles = {
  aigc: '检查图像生成线索',
  sica: '检查整图异常',
  rita: '定位照片可疑区域',
  rise: '定位文档可疑区域'
}

export function WorkflowConversation({ workspace: w }: { workspace: AnalysisWorkspace }) {
  const report = w.report?.workflow ? w.report : null
  const workflow = report?.workflow
  const [explanation, setExplanation] = useState<ExplanationReport | null>(null)
  const [explainState, setExplainState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [explainError, setExplainError] = useState('')
  const [retry, setRetry] = useState(0)
  const request = useRef<{ key: string; promise: Promise<Response<ExplanationReport>> } | null>(
    null
  )
  const body = useRef<HTMLDivElement | null>(null)
  const follow = useRef(true)

  useEffect(() => {
    if (!report || w.running) {
      setExplanation(null)
      setExplainState('idle')
      setExplainError('')
      return
    }
    if (report.explanation) {
      setExplanation(report.explanation)
      setExplainState('done')
      return
    }
    let active = true
    setExplainState('running')
    setExplainError('')
    const key = `${report.id}:${retry}`
    if (request.current?.key !== key)
      request.current = { key, promise: window.desktop.explain(report.id) }
    request.current.promise
      .then((result) => {
        if (!active) return
        if (result.ok) {
          setExplanation(result.data)
          setExplainState('done')
        } else {
          setExplainError(result.error)
          setExplainState('error')
        }
      })
      .catch(() => {
        if (active) {
          setExplainError('综合说明暂未生成，可以重试。')
          setExplainState('error')
        }
      })
    return () => {
      active = false
    }
  }, [report?.id, w.running, retry])

  const trace = w.progress ?? w.lastProgress
  const finished = !!workflow && !w.running && (!trace || trace.taskId === report?.id)
  const phase = finished ? 'aggregate' : (trace?.workflowPhase ?? 'prepare')
  const stopped = !w.running && !finished && !!trace
  const stopStatus = w.notice ? 'cancelled' : 'failed'
  const activeStatus = stopped ? stopStatus : 'running'
  const detectorSteps: WorkflowStep[] = finished
    ? workflow!.detectors
        .filter((d) => d.status !== 'not_run')
        .map((d) => ({
          backend: d.backend,
          status: d.reused ? 'reused' : d.status,
          message: trace?.steps?.find((s) => s.backend === d.backend)?.message
        }))
    : (trace?.steps ?? [])
  const auto = finished ? workflow?.routing?.mode === 'auto' : w.contentType === 'auto'
  const items: Item[] = [
    {
      id: 'prepare',
      title: '读取图片与来源信息',
      status: phase === 'prepare' ? activeStatus : 'completed',
      message:
        phase !== 'prepare' && w.image
          ? `图片已读取，尺寸 ${w.image.width} × ${w.image.height}。`
          : undefined
    }
  ]
  if (auto)
    items.push({
      id: 'routing',
      title: '确定图片检查流程',
      status:
        phase === 'prepare'
          ? 'pending'
          : phase === 'routing'
            ? activeStatus
            : (workflow?.routing?.status ?? trace?.routingStatus) === 'failed'
              ? 'failed'
              : 'completed',
      message:
        (workflow?.routing?.status ?? trace?.routingStatus) === 'failed'
          ? '自动识别未完成，已改为全面检查。'
          : undefined
    })
  items.push(
    ...detectorSteps.map((step) => ({
      id: step.backend,
      title: titles[step.backend],
      status: stopped && step.status === 'running' ? stopStatus : step.status,
      message: step.message
    }))
  )
  items.push({
    id: 'aggregate',
    title: '汇总检测证据',
    status: finished ? 'completed' : phase === 'aggregate' ? activeStatus : 'pending',
    message: finished ? '检测结果和标记区域已整理。' : undefined
  })
  items.push({
    id: 'explanation',
    title: '结合图片生成综合说明',
    status:
      explainState === 'running'
        ? 'running'
        : explainState === 'done'
          ? 'completed'
          : explainState === 'error'
            ? 'failed'
            : 'pending',
    message:
      explanation?.mode === 'mock'
        ? '已生成基础说明，可重试智能分析。'
        : explainState === 'done'
          ? '综合说明已生成。'
          : undefined
  })
  const current = items.findIndex((item) => item.status === 'running')
  const visible = items.filter((item) => item.status !== 'pending')
  const started = w.running || !!trace || !!report
  const result = explanation?.result
  useEffect(() => {
    if (follow.current && body.current) body.current.scrollTop = body.current.scrollHeight
  }, [
    trace?.label,
    trace?.steps?.map((step) => `${step.backend}:${step.status}`).join(','),
    explainState
  ])
  return (
    <section
      className="panel result-panel conversation-panel"
      aria-label="分析描述"
      aria-busy={w.running || explainState === 'running'}
    >
      <div className="panel-heading">
        <div>
          <MessageSquareText size={18} />
          <h2>图像分析</h2>
        </div>
        <span>{explainState === 'done' ? '说明已生成' : started ? '分析进程' : '待开始'}</span>
      </div>
      <div
        className="conversation-body"
        aria-live="polite"
        ref={body}
        onScroll={() => {
          if (body.current)
            follow.current =
              body.current.scrollHeight - body.current.scrollTop - body.current.clientHeight < 80
        }}
      >
        <div className="conversation-intro">
          <span className="assistant-avatar">
            <MessageSquareText size={17} />
          </span>
          <p>
            {started
              ? '已收到图片，以下是本次检查进度和分析结果。'
              : w.image
                ? '图片已就绪。开始分析后，我会逐步检查并说明值得注意的位置。'
                : '选择一张图片，我会结合检测结果和图像内容给出分析。'}
          </p>
        </div>
        {started && (
          <>
            <div className="conversation-counter" data-testid="workflow-step-counter">
              {current >= 0
                ? `第 ${current + 1} 步${detectorSteps.length ? ` / 共 ${items.length} 步` : ''} · ${items[current].title}`
                : explainState === 'done'
                  ? '本轮分析已结束'
                  : stopped
                    ? '分析已停止'
                    : '检测结果已保存'}
            </div>
            <ol className="conversation-timeline" data-testid="workflow-progress">
              {visible.map((item) => (
                <li key={item.id} data-status={item.status} data-step={item.id}>
                  <span className={`conversation-step-icon ${item.status}`}>
                    {item.status === 'running' ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : ['failed', 'cancelled'].includes(item.status) ? (
                      <CircleAlert size={16} />
                    ) : (
                      <Check size={16} />
                    )}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <p>
                      {item.status === 'running'
                        ? item.id === 'explanation'
                          ? '正在理解图片与标记区域，整理综合判断…'
                          : '正在检查，请稍候…'
                        : (item.message ??
                          (item.status === 'failed'
                            ? '这项检查未完成。'
                            : item.status === 'cancelled'
                              ? '已停止。'
                              : item.status === 'reused'
                                ? '已复用完成的检查结果。'
                                : '已完成。'))}
                    </p>
                    {item.status === 'running' && item.id !== 'explanation' && trace?.label && (
                      <small className="conversation-live" data-testid="analysis-progress-label">
                        {trace.label}
                      </small>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {w.running && (
              <button
                className="secondary-button"
                disabled={w.status === 'cancelling'}
                onClick={w.cancel}
              >
                {w.status === 'cancelling' ? '正在取消…' : '取消分析'}
              </button>
            )}
          </>
        )}
        {result && (
          <article className="conversation-answer" data-testid="analysis-report">
            <div className="conversation-answer-heading">
              <span className="assistant-avatar">
                <MessageSquareText size={17} />
              </span>
              <h3>综合分析</h3>
              <span className={`conversation-verdict ${result.finalDecision}`}>
                {result.finalDecision === 'suspicious'
                  ? '有可疑线索'
                  : result.finalDecision === 'no_anomaly_detected'
                    ? '未发现明显异常'
                    : '仍需进一步核查'}
              </span>
            </div>
            <p className="conversation-summary" data-testid="explanation-summary">
              {result.analysis}
            </p>
            {result.regionAnalyses?.map((region, index) => (
              <div
                className="conversation-region"
                key={region.regionId}
                data-testid="explanation-region"
              >
                <h4>
                  {result.primaryRegionId === region.regionId
                    ? '优先关注'
                    : `关注位置 ${index + 1}`}{' '}
                  · {region.subject}
                </h4>
                <small>{region.location}</small>
                {region.reason !== result.analysis && <p>{region.reason}</p>}
                {region.suspectedOperation && (
                  <p>
                    可能方式：{region.suspectedOperation}
                    {region.operationReason ? `。${region.operationReason}` : ''}
                  </p>
                )}
              </div>
            ))}
            {result.evidenceBalance && (
              <p className="conversation-balance">{result.evidenceBalance}</p>
            )}
            {explanation.mode === 'mock' && (
              <p className="conversation-muted">智能分析暂不可用，以上为基础说明。</p>
            )}
          </article>
        )}
        {(explainState === 'error' || explanation?.mode === 'mock') && (
          <div className="conversation-retry">
            <p>{explainError}</p>
            <button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>
              重新生成说明
            </button>
          </div>
        )}
        {report && (
          <details className="conversation-technical" data-testid="workflow-technical-details">
            <summary>检测详情与报告</summary>
            <WorkflowReport
              report={report}
              originalDataUrl={w.image?.dataUrl ?? ''}
              onSupplement={w.supplement}
              hideExplanation
            />
            {explanation && (
              <details>
                <summary>解释原始记录</summary>
                <pre>{JSON.stringify(explanation, null, 2)}</pre>
              </details>
            )}
          </details>
        )}
      </div>
    </section>
  )
}
