import { useState, type RefObject } from 'react'
import { Cpu, Settings2, X } from 'lucide-react'
import type { AnalysisBackend } from '../../../shared/contracts'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'
import { RuntimeSettings } from './RuntimeSettings'

const modes: { value: AnalysisBackend; label: string }[] = [
  { value: 'workflow', label: '联合分析' },
  { value: 'mock', label: '模拟流程' },
  { value: 'rita', label: 'RITA 本地定位' },
  { value: 'sica', label: 'SICA 图像二分类' },
  { value: 'rise', label: 'RiSE 文档定位' },
  { value: 'aigc', label: 'FSD AI 生成检测' }
]

export function SettingsDialog({
  dialogRef,
  workspace
}: {
  dialogRef: RefObject<HTMLDialogElement | null>
  workspace: AnalysisWorkspace
}) {
  const [tab, setTab] = useState<'runtime' | 'advanced'>('runtime')
  function openRuntimeSettings() {
    setTab('runtime')
    if (!dialogRef.current?.open) dialogRef.current?.showModal()
  }

  return (
    <dialog ref={dialogRef} className="settings-dialog" aria-labelledby="settings-title">
      <header className="settings-heading">
        <h2 id="settings-title">设置</h2>
        <button
          className="icon-button"
          aria-label="关闭设置"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} />
        </button>
      </header>
      <div className="settings-layout">
        <nav
          className="settings-navigation"
          role="tablist"
          aria-label="设置分类"
          aria-orientation="vertical"
          onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next =
              event.key === 'Home'
                ? 'runtime'
                : event.key === 'End'
                  ? 'advanced'
                  : tab === 'runtime'
                    ? 'advanced'
                    : 'runtime'
            setTab(next)
            document.getElementById(`settings-${next}-tab`)?.focus()
          }}
        >
          <button
            id="settings-runtime-tab"
            role="tab"
            aria-selected={tab === 'runtime'}
            aria-controls="settings-runtime-panel"
            tabIndex={tab === 'runtime' ? 0 : -1}
            onClick={() => setTab('runtime')}
          >
            <Settings2 size={16} />
            运行环境
          </button>
          <button
            id="settings-advanced-tab"
            role="tab"
            aria-selected={tab === 'advanced'}
            aria-controls="settings-advanced-panel"
            tabIndex={tab === 'advanced' ? 0 : -1}
            onClick={() => setTab('advanced')}
          >
            <Cpu size={16} />
            开发与单模型调试
          </button>
        </nav>
        <div
          id="settings-runtime-panel"
          className="settings-content"
          role="tabpanel"
          aria-labelledby="settings-runtime-tab"
          hidden={tab !== 'runtime'}
        >
          <RuntimeSettings
            busy={workspace.busy}
            onDirectoryChanged={workspace.clearImage}
            onSetupRequired={openRuntimeSettings}
          />
        </div>
        <div
          id="settings-advanced-panel"
          className="settings-content"
          role="tabpanel"
          aria-labelledby="settings-advanced-tab"
          hidden={tab !== 'advanced'}
        >
          <h3>分析模式</h3>
          <div className="backend-picker" role="group" aria-label="分析服务">
            {modes.map((mode) => (
              <button
                key={mode.value}
                aria-pressed={workspace.backend === mode.value}
                disabled={workspace.busy}
                onClick={() => {
                  workspace.selectBackend(mode.value)
                  dialogRef.current?.close()
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </dialog>
  )
}
