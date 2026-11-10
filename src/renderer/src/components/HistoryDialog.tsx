import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Clock3, Image, LoaderCircle, Search, X } from 'lucide-react'
import type { HistoryEntry, HistoryPage } from '../../../shared/contracts'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'

const names = {
  workflow: '联合分析',
  mock: '模拟流程',
  aigc: 'FSD',
  sica: 'SICA',
  rita: 'RITA',
  rise: 'RiSE'
}
const statuses = { completed: '已完成', partial: '部分完成', failed: '未完成' }
const emptyPage: HistoryPage = { entries: [], total: 0, skipped: 0 }
function dateGroup(value: string): string {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return '今天'
  today.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return '昨天'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function HistoryDialog({
  open,
  onClose,
  workspace
}: {
  open: boolean
  onClose(): void
  workspace: AnalysisWorkspace
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState<HistoryPage>(emptyPage)
  const [loading, setLoading] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      dialogRef.current?.close()
      return
    }
    setPage(emptyPage)
    setQuery('')
    setLoading(true)
    setError('')
    dialogRef.current?.showModal()
    search.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const request = ++generation.current
    setLoading(true)
    setError('')
    const timer = setTimeout(
      () => {
        window.desktop
          .listHistory(query, 0)
          .then((result) => {
            if (generation.current !== request) return
            if (result.ok) setPage(result.data)
            else setError(result.error)
          })
          .catch(() => {
            if (generation.current === request) setError('无法读取历史记录，请重试。')
          })
          .finally(() => {
            if (generation.current === request) setLoading(false)
          })
      },
      query ? 180 : 0
    )
    return () => {
      clearTimeout(timer)
      generation.current++
    }
  }, [open, query, reload])

  async function more() {
    const request = generation.current
    setLoading(true)
    setError('')
    try {
      const result = await window.desktop.listHistory(query, page.entries.length)
      if (generation.current !== request) return
      if (result.ok)
        setPage((previous) => ({
          ...result.data,
          entries: [...previous.entries, ...result.data.entries]
        }))
      else setError(result.error)
    } catch {
      if (generation.current === request) setError('无法读取更多记录，请重试。')
    } finally {
      if (generation.current === request) setLoading(false)
    }
  }

  async function select(entry: HistoryEntry) {
    if (opening || workspace.busy) return
    setOpening(entry.id)
    setError('')
    if (await workspace.openHistory(entry.id)) onClose()
    else setError('这条记录无法打开，请检查图像与报告文件。')
    setOpening(null)
  }

  return (
    <dialog
      ref={dialogRef}
      className="history-dialog"
      aria-labelledby="history-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!opening) onClose()
      }}
      onClose={onClose}
    >
      <header className="settings-heading">
        <h2 id="history-title">
          <Clock3 size={17} />
          历史记录
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭历史记录"
          disabled={!!opening}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="history-search">
        <Search size={16} />
        <input
          ref={search}
          type="search"
          aria-label="搜索历史记录"
          placeholder="搜索图像名称"
          maxLength={200}
          value={query}
          disabled={!!opening}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {error && (
        <div className="history-error" role="alert">
          <span>{error}</span>
          <button
            className="text-button"
            disabled={!!opening}
            onClick={() => setReload((value) => value + 1)}
          >
            重试
          </button>
        </div>
      )}
      <div className="history-list" aria-label="检测记录" aria-busy={loading || !!opening}>
        {!page.entries.length && loading ? (
          <div className="history-empty" role="status">
            <LoaderCircle size={24} className="spin" />
            <span>正在读取记录</span>
          </div>
        ) : !page.entries.length && !error ? (
          <div className="history-empty">
            <Clock3 size={30} strokeWidth={1.25} />
            <span>{query ? '未找到匹配的记录' : '暂无检测记录'}</span>
          </div>
        ) : (
          page.entries.map((entry, index) => {
            const group = dateGroup(entry.createdAt)
            const showGroup = index === 0 || dateGroup(page.entries[index - 1].createdAt) !== group
            return (
              <div key={entry.id}>
                {showGroup && <h3 className="history-date">{group}</h3>}
                <button
                  className="history-row"
                  disabled={!!opening || loading}
                  onClick={() => void select(entry)}
                  aria-label={`查看 ${entry.name}`}
                >
                  <span className="history-thumbnail">
                    {entry.thumbnailDataUrl ? (
                      <img src={entry.thumbnailDataUrl} alt="" />
                    ) : (
                      <Image size={21} />
                    )}
                  </span>
                  <span className="history-row-copy">
                    <strong title={entry.name}>{entry.name}</strong>
                    <span>
                      <time dateTime={entry.createdAt}>
                        {new Date(entry.createdAt).toLocaleTimeString('zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </time>
                      <span>·</span>
                      {entry.width} × {entry.height}
                      <span>·</span>
                      {names[entry.backend]}
                      {entry.mode === 'mock' && entry.backend !== 'mock' ? ' · 模拟' : ''}
                    </span>
                  </span>
                  <span className={`history-status ${entry.status}`}>
                    {opening === entry.id ? '正在打开' : statuses[entry.status]}
                  </span>
                  {opening === entry.id ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <ChevronRight size={15} />
                  )}
                </button>
              </div>
            )
          })
        )}
      </div>
      <footer className="history-footer">
        <span role="status">
          {loading ? '正在读取…' : `${page.total} 条记录`}
          {page.skipped > 0 && ` · ${page.skipped} 条记录无法读取`}
        </span>
        {page.entries.length < page.total && (
          <button
            className="text-button"
            disabled={loading || !!opening}
            onClick={() => void more()}
          >
            加载更多
          </button>
        )}
      </footer>
    </dialog>
  )
}
