const storageKey = 'authenticity.accent-color'
const modeStorageKey = 'authenticity.appearance'
export type AppearanceMode = 'light' | 'dark' | 'system'
export const defaultAccent = '#426558'
export const themePresets = [
  { name: '松绿', color: defaultAccent },
  { name: '雾蓝', color: '#4d6f9a' },
  { name: '鸢紫', color: '#7563a3' },
  { name: '岩灰', color: '#59616a' },
  { name: '赭金', color: '#92703c' },
  { name: '玫瑰', color: '#9a5f68' }
]

export const validColor = (color: string) => /^#[\da-f]{6}$/i.test(color)
const rgb = (color: string) => [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16))
function blend(color: string, background: string, amount: number): string {
  const base = rgb(background)
  return (
    '#' +
    rgb(color)
      .map((value, index) =>
        Math.round(value * amount + base[index] * (1 - amount))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  )
}
function luminance(color: string): number {
  return rgb(color).reduce((total, channel, index) => {
    const value = channel / 255
    return (
      total +
      (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
        [0.2126, 0.7152, 0.0722][index]
    )
  }, 0)
}
export function colorContrast(first: string, second: string): number {
  const a = luminance(first),
    b = luminance(second)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}
function readableColor(
  color: string,
  background: string,
  minimum: number,
  target = '#202722'
): string {
  for (let amount = 1; amount >= 0; amount -= 0.02) {
    const candidate = blend(color, target, amount)
    if (colorContrast(candidate, background) >= minimum) return candidate
  }
  return target
}

export function themeTokens(
  color: string,
  appearance: 'light' | 'dark' = 'light'
): Record<string, string> {
  const dark = appearance === 'dark'
  const base = blend(color, dark ? '#15191b' : '#edf1ef', dark ? 0.13 : 0.1)
  const panel = blend(color, dark ? '#222729' : '#fcfdfb', dark ? 0.09 : 0.035)
  const toolbar = blend(color, dark ? '#1c2123' : '#f2f5f3', dark ? 0.1 : 0.065)
  const canvas = blend(color, dark ? '#191e20' : '#f0f4f1', dark ? 0.07 : 0.075)
  const control = blend(color, dark ? '#2c3234' : '#ffffff', dark ? 0.09 : 0.025)
  const selected = blend(color, dark ? '#30383a' : '#f4f7f4', dark ? 0.15 : 0.12)
  const hover = blend(color, dark ? '#2b3234' : '#eaf0ec', dark ? 0.1 : 0.07)
  const surfaces = [base, panel, toolbar, canvas, control, selected, hover]
  const contrastSurface = surfaces.reduce((current, value) =>
    (dark ? luminance(value) > luminance(current) : luminance(value) < luminance(current))
      ? value
      : current
  )
  const textTarget = dark ? '#f5f9f7' : '#18221d'
  const readable = (value: string, minimum: number) =>
    readableColor(value, contrastSurface, minimum, textTarget)
  const ink = readable(blend(color, dark ? '#edf2ef' : '#202a25', 0.06), 7)
  const secondary = readable(blend(color, dark ? '#becbc5' : '#4f5d55', 0.07), 4.7)
  const muted = readable(blend(color, dark ? '#9caaa3' : '#627067', 0.07), 4.55)
  const accent = readable(color, 4.7)
  const actionInk = dark ? '#142019' : '#fafcfb'
  const action = readableColor(color, actionInk, 6, dark ? '#edf5ef' : '#18221d')
  const success = readable(dark ? '#9bcdb0' : '#35664a', 4.7)
  const warning = readable(dark ? '#ddbf8a' : '#805f37', 4.7)
  const error = readable(dark ? '#e9a7a0' : '#944d47', 4.7)
  return {
    '--surface-base': base,
    '--surface-panel': panel,
    '--surface-toolbar': toolbar,
    '--surface-canvas': canvas,
    '--surface-workspace': canvas,
    '--surface-inspector': panel,
    '--surface-control': control,
    '--surface-muted': blend(ink, panel, dark ? 0.04 : 0.025),
    '--stroke-subtle': blend(ink, panel, dark ? 0.15 : 0.13),
    '--stroke-strong': blend(ink, panel, dark ? 0.36 : 0.3),
    '--stroke-divider': blend(ink, panel, dark ? 0.2 : 0.17),
    '--ink-primary': ink,
    '--ink-secondary': secondary,
    '--ink-muted': muted,
    '--ink-disabled': blend(ink, panel, 0.43),
    '--accent': accent,
    '--accent-hover': blend(accent, textTarget, 0.8),
    '--accent-soft': selected,
    '--action-fill': action,
    '--action-hover': blend(action, dark ? '#ffffff' : '#111a15', 0.86),
    '--action-ink': actionInk,
    '--disabled-fill': blend(ink, panel, 0.075),
    '--disabled-ink': readableColor(muted, panel, 3.2, textTarget),
    '--surface-selected': selected,
    '--surface-hover': hover,
    '--focus-ring': readable(color, 3.2),
    '--selection-fill': selected,
    '--scan-tint': accent + '14',
    '--scan-line': accent + 'b3',
    '--control-indicator': readable(color, 3.2),
    '--success-ink': success,
    '--success-fill': blend(success, panel, 0.07),
    '--success-stroke': blend(success, panel, 0.24),
    '--warning-ink': warning,
    '--warning-fill': blend(warning, panel, 0.07),
    '--warning-stroke': blend(warning, panel, 0.24),
    '--error-ink': error,
    '--error-fill': blend(error, panel, 0.07),
    '--error-stroke': blend(error, panel, 0.24),
    '--info-ink': accent,
    '--info-fill': blend(accent, panel, 0.06),
    '--info-stroke': blend(accent, panel, 0.22),
    '--scrim': dark ? '#05090899' : '#17241d4d',
    '--preview-scrim': dark ? '#050908c9' : '#17241d8f',
    '--image-shadow': dark
      ? '0 6px 24px #00000045, 0 1px 3px #00000030'
      : '0 5px 20px #1d261e14, 0 1px 2px #1d261e12',
    '--dialog-shadow': dark ? '0 20px 72px #00000066, 0 0 0 1px #ffffff0d' : '0 20px 72px #1d251f2b'
  }
}

export function readThemeColor(): string {
  try {
    const color = localStorage.getItem(storageKey)
    return color && validColor(color) ? color.toLowerCase() : defaultAccent
  } catch {
    return defaultAccent
  }
}

export function readAppearanceMode(): AppearanceMode {
  try {
    const mode = localStorage.getItem(modeStorageKey)
    return mode === 'light' || mode === 'dark' ? mode : 'system'
  } catch {
    return 'system'
  }
}

export function applyThemeColor(color: string, mode = readAppearanceMode()): void {
  if (!validColor(color)) return
  const appearance =
    mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
      ? 'dark'
      : 'light'
  const tokens = themeTokens(color, appearance)
  document.documentElement.dataset.appearance = appearance
  document.documentElement.style.colorScheme = appearance
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value)
  }
  void window.desktop
    ?.setWindowTheme?.({
      mode,
      background: tokens['--surface-base'],
      foreground: tokens['--ink-primary']
    })
    .catch(() => {})
}

export function initializeTheme(): void {
  applyThemeColor(readThemeColor())
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (readAppearanceMode() === 'system') applyThemeColor(readThemeColor())
  })
}

export function saveAppearanceMode(mode: AppearanceMode): boolean {
  applyThemeColor(readThemeColor(), mode)
  try {
    localStorage.setItem(modeStorageKey, mode)
    return true
  } catch {
    return false
  }
}

export function saveThemeColor(color: string): boolean {
  applyThemeColor(color)
  try {
    localStorage.setItem(storageKey, color.toLowerCase())
    return true
  } catch {
    return false
  }
}
