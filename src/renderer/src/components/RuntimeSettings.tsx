import { useEffect, useState } from 'react'
import type { RuntimeEnvironment, RuntimeSetupProgress } from '../../../shared/contracts'
import '../runtime-settings.css'

export function RuntimeSettings({
  busy,
  onDirectoryChanged
}: {
  busy: boolean
  onDirectoryChanged: () => Promise<void>
}) {
  const [environment, setEnvironment] = useState<RuntimeEnvironment | null>(null)
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [progress, setProgress] = useState<RuntimeSetupProgress | null>(null)

  useEffect(() => {
    window.desktop
      .runtimeEnvironment()
      .then((result) => {
        if (result.ok) setEnvironment(result.data)
        else setError(result.error)
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
    <details
      className="runtime-settings"
      open={
        preparing ||
        (environment?.packaged &&
          (!environment.directory || (environment.setup.available && !environment.setup.ready)))
      }
    >
      <summary>本地运行环境{environment?.setup.ready ? ' · 已就绪' : ''}</summary>
      <p>
        选择保存模型、配置和报告的文件夹。已有项目可直接选择其根目录，也可以在其他磁盘新建目录。
        团队完整包支持自动展开 Python、模型权重和本地解释服务。
      </p>
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
                : '一键配置完整科研环境'}
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
      {environment?.setup.ready && <p>完整科研环境已准备，应用启动时会自动启动本地解释服务。</p>}
      <small>更换目录后重新选择图片。配置文件是否存在与模型是否能够成功推理分别检查。</small>
      {error && <p role="alert">{error}</p>}
    </details>
  )
}
