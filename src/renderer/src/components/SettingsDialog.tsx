import { useState, type RefObject } from 'react'
import { Cpu, Palette, Settings2, X } from 'lucide-react'
import type { AnalysisBackend } from '../../../shared/contracts'
import type { AnalysisWorkspace } from '../hooks/useAnalysisWorkspace'
import { RuntimeSettings } from './RuntimeSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { version } from '../../../../package.json'

const tabs = [
  { value: 'runtime', label: '运行环境', icon: Settings2 },
  { value: 'appearance', label: '外观', icon: Palette },
  { value: 'advanced', label: '开发与单模型调试', icon: Cpu }
] as const

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
  const [tab, setTab] = useState<(typeof tabs)[number]['value']>('runtime')
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
            const current = tabs.findIndex((item) => item.value === tab)
            const nextIndex =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : (current + (event.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length
            const next = tabs[nextIndex].value
            setTab(next)
            document.getElementById(`settings-${next}-tab`)?.focus()
          }}
        >
          {tabs.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              id={`settings-${value}-tab`}
              role="tab"
              aria-selected={tab === value}
              aria-controls={`settings-${value}-panel`}
              tabIndex={tab === value ? 0 : -1}
              onClick={() => setTab(value)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
          <span className="settings-version">v{version}</span>
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
          id="settings-appearance-panel"
          className="settings-content"
          role="tabpanel"
          aria-labelledby="settings-appearance-tab"
          hidden={tab !== 'appearance'}
        >
          <AppearanceSettings />
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
