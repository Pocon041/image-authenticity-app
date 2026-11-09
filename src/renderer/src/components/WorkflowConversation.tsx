import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquareText,
  ScanLine
} from 'lucide-react'
import type { ExplanationProgress, Response, WorkflowStep } from '../../../shared/contracts'
import type { ExplanationReport } from '../../../shared/protocol'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'
import { WorkflowReport } from './WorkflowReport'
import { StepPreview } from './StepPreview'
import { ResponseText } from './ResponseText'
import '../conversation.css'

type Item = {
  id: string
  title: string
  status: WorkflowStep['status']
  message?: string
  preview?: WorkflowStep['preview']
}
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
  const [activityOpen, setActivityOpen] = useState(true)
  const [stream, setStream] = useState<ExplanationProgress | null>(null)
  const [stopping, setStopping] = useState(false)
  const request = useRef<{ key: string; promise: Promise<Response<ExplanationReport>> } | null>(
    null
  )
  const body = useRef<HTMLDivElement | null>(null)
  const follow = useRef(true)

  useEffect(() => {
    setActivityOpen(true)
    setStream(null)
    follow.current = true
  }, [w.image?.id, (w.progress ?? w.lastProgress)?.taskId, retry])

  useEffect(() => {
    if (!report || w.running) return
    return window.desktop.onExplanationProgress((progress) => {
      if (progress.taskId === report.id && progress.imageId === report.imageId)
        setStream((previous) => ({
          ...progress,
          text: progress.text ?? previous?.text,
          decision: progress.decision ?? previous?.decision
        }))
    })
  }, [report?.id, w.running])

  useEffect(() => {
    if (!report || w.running) {
      setExplanation(null)
      setExplainState('idle')
      setExplainError('')
      return
    }
    if (report.explanation) {
      setExplanation(report.explanation)
      setExplainState(report.explanation.mode === 'local' ? 'done' : 'error')
      setExplainError(
        report.explanation.mode === 'local' ? '' : '智能分析未完成，已完成的检测结果仍可展开查看。'
      )
      setActivityOpen(report.explanation.mode !== 'local')
      return
    }
    let active = true
    setExplanation(null)
    setStream(null)
    setExplainState('running')
    setStopping(false)
    setExplainError('')
    const key = `${report.id}:${retry}`
    if (request.current?.key !== key)
      request.current = { key, promise: window.desktop.explain(report.id) }
    request.current.promise
      .then((result) => {
        if (!active) return
        setStopping(false)
        if (result.ok) {
          setExplanation(result.data)
          setExplainState(result.data.mode === 'local' ? 'done' : 'error')
          setExplainError(
            result.data.mode === 'local' ? '' : '智能分析未完成，已完成的检测结果仍可展开查看。'
          )
          setActivityOpen(result.data.mode !== 'local')
        } else {
          setExplainError(result.error)
          setExplainState('error')
        }
      })
      .catch(() => {
        if (active) {
          setStopping(false)
          setExplainError('综合说明暂未生成，可以重试。')
          setExplainState('error')
        }
      })
    return () => {
      active = false
    }
  }, [report?.id, w.running, retry])

  async function stopExplanation() {
    if (!report || stopping) return
    setStopping(true)
    try {
      const result = await window.desktop.cancelAnalysis(report.id)
      if (!result.ok || !result.data) {
        setStopping(false)
        if (!result.ok) setExplainError(result.error)
      }
    } catch {
      setStopping(false)
      setExplainError('暂时无法停止生成，请稍后重试。')
    }
  }

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
          preview: d.localization,
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
      preview: step.preview,
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
  const result = explanation?.mode === 'local' ? explanation.result : undefined
  // stream.decision is an intermediate assessment; only the completed report is a final verdict.
  const verdict = result?.finalDecision
  const pendingAssessment = !result && explainState === 'running' && !!stream?.decision
  const answerText = String(result?.analysis ?? stream?.text ?? '')
  const lead = String(result?.lead ?? '')
  const localizers =
    workflow?.detectors.filter(
      (detector) => detector.status === 'completed' && detector.localization?.overlayDataUrl
    ) ?? []
  const primaryLocalizer =
    localizers.find((detector) => detector.backend === workflow?.primary) ?? localizers[0]
  const imageView =
    w.imageView && w.imageView.taskId === report?.id
      ? w.imageView.view
      : (primaryLocalizer?.backend ?? 'original')
  const detailText =
    lead && answerText.startsWith(lead) ? answerText.slice(lead.length).trim() : answerText
  useEffect(() => {
    if (!body.current) return
    if (explainState === 'done') body.current.scrollTop = 0
    else if (follow.current) body.current.scrollTop = body.current.scrollHeight
  }, [
    trace?.label,
    trace?.steps?.map((step) => `${step.backend}:${step.status}`).join(','),
    explainState,
    stream?.text
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
          <h2>分析结果</h2>
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
        {!started && (
          <div className="conversation-intro">
            <span className="assistant-avatar">
              <MessageSquareText size={17} />
            </span>
            <div>
              <h3>{w.image ? '图片已就绪' : '暂无分析结果'}</h3>
              {w.image && <p>点击“开始分析”</p>}
            </div>
          </div>
        )}
        {started && (
          <>
            <details
              className="conversation-activity"
              open={activityOpen}
              onToggle={(event) => setActivityOpen(event.currentTarget.open)}
            >
              <summary className="conversation-counter" data-testid="workflow-step-counter">
                {current >= 0 ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                <span>
                  {current >= 0
                    ? `第 ${current + 1} 步${detectorSteps.length ? ` / 共 ${items.length} 步` : ''} · ${items[current].title}`
                    : explainState === 'done'
                      ? '查看分析过程'
                      : w.running
                        ? '本步已完成，正在继续分析'
                        : stopped
                          ? '分析已停止'
                          : '检测结果已保存'}
                </span>
                <ChevronRight size={14} className="activity-chevron" />
              </summary>
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
                    <div className="conversation-step-content">
                      <strong>{item.title}</strong>
                      <p>
                        {item.status === 'running'
                          ? item.id === 'explanation'
                            ? (stream?.label ?? '正在理解图片与标记区域，整理综合判断…')
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
                      {item.preview && ['completed', 'reused'].includes(item.status) && (
                        <StepPreview
                          preview={item.preview}
                          name={item.id === 'rise' ? 'RiSE' : 'RITA'}
                          original={w.image?.dataUrl ?? ''}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </details>
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
        {workflow?.status === 'partial' && (
          <p className="partial-result-note" role="status">
            有部分检查未完成。当前结果已保留，完整原因可在检测详情中查看。
          </p>
        )}
        {(result || (explainState === 'running' && (stream?.text || pendingAssessment))) && (
          <article className="conversation-answer" data-testid="analysis-report">
            {verdict ? (
              <div
                className={`conversation-conclusion report-verdict ${verdict}`}
                data-testid="explanation-conclusion"
              >
                <div className="verdict-label">
                  <FileText size={15} />
                  <span>综合判断</span>
                </div>
                <strong>
                  {verdict === 'suspicious'
                    ? result?.aiGenerationSource === 'credentials'
                      ? '来源明确：AI生成或合成'
                      : result?.aiGeneration === 'supported'
                        ? '检测到AI生成或合成线索'
                        : result?.decisionSource === 'evidence_fusion' &&
                            result?.localManipulation === 'supported'
                          ? '检测到局部篡改'
                          : result?.localManipulation === 'supported'
                            ? '疑似局部篡改'
                            : '发现可疑线索'
                    : verdict === 'no_anomaly_detected'
                      ? '未发现明显异常线索'
                      : '暂不能确定'}
                </strong>
                {lead && <p className="conclusion-target conclusion-lead">{lead}</p>}
              </div>
            ) : pendingAssessment ? (
              <div
                className="conversation-conclusion report-verdict pending"
                data-testid="explanation-conclusion"
              >
                <div className="verdict-label">
                  <LoaderCircle size={15} className="spin" />
                  <span>综合判断</span>
                </div>
                <strong>正在综合判断</strong>
                <p className="conclusion-target conclusion-lead">
                  正在结合完整图片、局部区域和检测证据。
                </p>
              </div>
            ) : null}
            <div className="conversation-answer-heading">
              <span className="assistant-avatar">
                <MessageSquareText size={17} />
              </span>
              <h3>{explainState === 'running' ? '正在撰写分析' : '分析说明'}</h3>
            </div>
            {primaryLocalizer && (
              <div className="evidence-actions" role="group" aria-label="图像核查">
                <button
                  type="button"
                  aria-pressed={imageView === 'original'}
                  onClick={() => w.selectImageView('original')}
                >
                  <ImageIcon size={14} />
                  查看原图
                </button>
                <button
                  type="button"
                  aria-pressed={imageView !== 'original'}
                  onClick={() => w.selectImageView(primaryLocalizer.backend)}
                >
                  <ScanLine size={14} />
                  查看定位
                </button>
              </div>
            )}
            <ResponseText text={detailText} streaming={explainState === 'running'} />
            {!!result?.evidenceLinks?.length && (
              <section
                className="conversation-evidence-links"
                data-testid="explanation-evidence-links"
              >
                <h4>证据关系</h4>
                <ul>
                  {result.evidenceLinks.map((link, index) => (
                    <li key={`${link.relation}-${link.question}-${index}`}>
                      <span className={`evidence-link-strength ${link.strength}`}>
                        {link.strength === 'strong' ? '相互支持' : '补充关系'}
                      </span>
                      {link.description}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {result?.evidenceBalance && (
              <p className="conversation-balance">{result.evidenceBalance}</p>
            )}
          </article>
        )}
        {explainState === 'running' && (
          <div className="generation-controls">
            <button
              type="button"
              className="text-button"
              onClick={stopExplanation}
              disabled={stopping}
            >
              {stopping ? '正在停止…' : '停止生成'}
            </button>
          </div>
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
          <details
            className="conversation-technical report-details"
            data-testid="workflow-technical-details"
          >
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
