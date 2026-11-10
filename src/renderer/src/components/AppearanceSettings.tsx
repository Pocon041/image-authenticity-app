import { useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import {
  defaultAccent,
  readThemeColor,
  saveThemeColor,
  themePresets,
  validColor,
  readAppearanceMode,
  saveAppearanceMode
} from '../theme'

export function AppearanceSettings() {
  const [color, setColor] = useState(readThemeColor)
  const [draft, setDraft] = useState(color)
  const [error, setError] = useState('')
  const [mode, setMode] = useState(readAppearanceMode)
  function choose(next: string) {
    setColor(next.toLowerCase())
    setDraft(next.toLowerCase())
    setError(saveThemeColor(next) ? '' : '主题暂时无法保存，重启后请重新选择。')
  }
  function commit() {
    const value = draft.trim().replace(/^#/, '')
    const expanded = value.length === 3 ? [...value].map((digit) => digit + digit).join('') : value
    const next = '#' + expanded
    if (!validColor(next)) {
      setError('请输入有效色值，如 #426558。')
      return
    }
    choose(next)
  }
  return (
    <section className="appearance-settings" aria-label="外观设置">
      <h3>显示模式</h3>
      <fieldset className="appearance-modes">
        <legend className="sr-only">显示模式</legend>
        {(
          [
            { value: 'light', label: '浅色' },
            { value: 'dark', label: '深色' },
            { value: 'system', label: '跟随系统' }
          ] as const
        ).map((item) => (
          <label key={item.value}>
            <input
              type="radio"
              name="appearance-mode"
              value={item.value}
              checked={mode === item.value}
              onChange={() => {
                setMode(item.value)
                setError(saveAppearanceMode(item.value) ? '' : '显示模式暂时无法保存。')
              }}
            />
            <span className={`appearance-sample ${item.value}`} aria-hidden="true">
              <i />
              <b />
              <em />
            </span>
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
      <h3>主题色</h3>
      <fieldset className="theme-presets">
        <legend className="sr-only">预设主题色</legend>
        {themePresets.map((preset) => (
          <label key={preset.color} className="theme-preset">
            <input
              type="radio"
              name="theme-color"
              value={preset.color}
              checked={color === preset.color}
              onChange={() => choose(preset.color)}
            />
            <span className="theme-swatch" style={{ background: preset.color }}>
              {color === preset.color && <Check size={16} />}
            </span>
            <span>{preset.name}</span>
          </label>
        ))}
      </fieldset>
      <div className="custom-theme-row">
        <label className="color-picker-label">
          <input
            type="color"
            value={color}
            aria-label="自定义主题色"
            onChange={(event) => choose(event.target.value)}
          />
          <span>自定义</span>
        </label>
        <input
          className="color-hex-input"
          aria-label="主题色色值"
          value={draft}
          maxLength={7}
          spellCheck={false}
          aria-invalid={!!error && !validColor(draft)}
          onChange={(event) => {
            setDraft(event.target.value)
            setError('')
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
          }}
        />
      </div>
      {error && (
        <p className="appearance-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="theme-reset text-button"
        onClick={() => {
          setMode('system')
          const saved = saveAppearanceMode('system')
          choose(defaultAccent)
          if (!saved) setError('显示模式暂时无法保存。')
        }}
        disabled={color === defaultAccent && draft === defaultAccent && mode === 'system'}
      >
        <RotateCcw size={14} />
        恢复默认
      </button>
    </section>
  )
}
