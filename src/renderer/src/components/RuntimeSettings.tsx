import { useEffect, useState } from 'react'
import type { RuntimeEnvironment } from '../../../shared/contracts'
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

  useEffect(() => {
    window.desktop
      .runtimeEnvironment()
      .then((result) => {
        if (result.ok) setEnvironment(result.data)
        else setError(result.error)
      })
      .catch(() => setError('无法读取本地运行环境。'))
  }, [])

  async function chooseDirectory() {
    setSelecting(true)
    setError('')
    try {
      const result = await window.desktop.chooseRuntimeDirectory()
      if (!result.ok) setError(result.error)
      else if (result.data) {
        setEnvironment(result.data)
        await onDirectoryChanged()
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

  if (!environment && !error) return null
  return (
    <details className="runtime-settings" open={environment?.packaged && !environment.directory}>
      <summary>本地运行环境</summary>
      <p>
        选择保存模型、配置和报告的文件夹。已有项目可直接选择其根目录，也可以在其他磁盘新建目录。
        Python 环境、模型权重和 Ollama 模型按配置说明准备。
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
        <button disabled={busy || selecting} onClick={() => void chooseDirectory()}>
          {selecting ? '正在选择…' : '选择模型与报告目录'}
        </button>
        <button
          disabled={!environment?.directory || selecting}
          onClick={() => void openDirectory()}
        >
          打开目录与配置说明
        </button>
      </div>
      <small>更换目录后重新选择图片。配置文件是否存在与模型是否能够成功推理分别检查。</small>
      {error && <p role="alert">{error}</p>}
    </details>
  )
}
