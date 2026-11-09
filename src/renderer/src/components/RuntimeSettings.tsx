import { useEffect, useRef, useState } from 'react'
import type { RuntimeEnvironment, RuntimeSetupProgress } from '../../../shared/contracts'
import '../runtime-settings.css'

export function RuntimeSettings({
  busy,
  onDirectoryChanged,
  onSetupRequired
}: {
  busy: boolean
  onDirectoryChanged: () => Promise<void>
  onSetupRequired: () => void
}) {
  const [environment, setEnvironment] = useState<RuntimeEnvironment | null>(null)
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState<RuntimeSetupProgress | null>(null)
  const requestSetup = useRef(onSetupRequired)
  requestSetup.current = onSetupRequired

  useEffect(() => {
    window.desktop
      .runtimeEnvironment()
      .then((result) => {
        if (result.ok) {
          setEnvironment(result.data)
          const current = result.data
          if (
            current.packaged &&
            (!current.directory || (current.setup.available && !current.setup.ready))
          ) {
            requestSetup.current()
          }
        } else setError(result.error)
      })
      .catch(() => setError('无法读取本地运行环境。'))
  }, [])

  useEffect(() => window.desktop.onRuntimeSetupProgress(setProgress), [])

  async function prepare() {
    setPreparing(true)
    setError('')
    try {
      const result = await window.desktop.prepareRuntime()
      if (!result.ok) setError(result.error)
      else {
        setEnvironment(result.data)
        await onDirectoryChanged()
      }
    } catch {
      setError('自动配置中断，可以重试。')
    } finally {
      setPreparing(false)
    }
  }

  async function chooseDirectory() {
    setSelecting(true)
    setError('')
    try {
      const result = await window.desktop.chooseRuntimeDirectory()
      if (!result.ok) setError(result.error)
      else if (result.data) {
        setEnvironment(result.data)
        setProgress(null)
        await onDirectoryChanged()
        setSelecting(false)
        if (result.data.setup.available && !result.data.setup.ready) await prepare()
      }
    } catch {
      setError('无法选择目录，请重试。')
    } finally {
      setSelecting(false)
    }
  }

  async function openDirectory() {
    const result = await window.desktop.openRuntimeDirectory()
    if (!result.ok) setError(result.error)
  }

  async function chooseBundle() {
    setError('')
    const result = await window.desktop.chooseRuntimeBundle()
    if (!result.ok) setError(result.error)
    else if (result.data) setEnvironment(result.data)
  }

  if (!environment && !error) return null
  return (
    <section className="runtime-settings">
      <h3>本地运行环境</h3>
      <p>模型、配置与报告保存在此目录。</p>
      <p className="runtime-directory" data-testid="runtime-directory">
        {environment?.directory ?? '尚未选择模型与报告目录'}
      </p>
      {environment?.configurations && (
        <p className="runtime-configurations">
          已找到配置{' '}
          {environment.configurations
            .filter((item) => item.configured)
            .map((item) => item.name)
            .join('、') || '暂无'}
        </p>
      )}
      <div className="runtime-actions">
        <button disabled={busy || selecting || preparing} onClick={() => void chooseDirectory()}>
          {selecting
            ? '正在选择…'
            : environment?.setup.available && !environment.setup.ready
              ? '选择数据目录并自动配置'
              : '选择模型与报告目录'}
        </button>
        {environment?.setup.available && (
          <button
            disabled={busy || selecting || preparing || !environment.directory}
            onClick={() => void prepare()}
          >
            {preparing
              ? '正在自动配置…'
              : environment.setup.ready
                ? '检查完整运行环境'
                : '自动配置运行环境'}
          </button>
        )}
        {!environment?.setup.available && (
          <button disabled={busy || selecting || preparing} onClick={() => void chooseBundle()}>
            选择完整资源包
          </button>
        )}
        {preparing && (
          <button onClick={() => void window.desktop.cancelRuntimeSetup()}>取消配置</button>
        )}
        <button
          disabled={!environment?.directory || selecting}
          onClick={() => void openDirectory()}
        >
          打开目录与配置说明
        </button>
      </div>
      {progress && (
        <p role="status" data-testid="runtime-setup-progress" data-stage={progress.stage}>
          {progress.total > 0 ? `${progress.completed}/${progress.total}　` : ''}
          {progress.label}
        </p>
      )}
      {environment?.setup.ready && <p>运行环境已就绪</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
