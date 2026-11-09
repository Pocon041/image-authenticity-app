import type { PropsWithChildren, ReactNode } from 'react'
import { ScanLine } from 'lucide-react'
import { version } from '../../../../package.json'

export function WorkspaceLayout({ children, actions }: PropsWithChildren<{ actions?: ReactNode }>) {
  return (
    <div className="app-shell">
      <main>
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true">
              <ScanLine size={18} strokeWidth={1.7} />
            </span>
            <div className="brand-copy">
              <h1>通用鉴伪系统</h1>
            </div>
          </div>
          <div className="toolbar-actions">
            <span className="local-badge">v{version}</span>
            {actions}
          </div>
        </header>
        <div className="workspace">{children}</div>
      </main>
    </div>
  )
}
