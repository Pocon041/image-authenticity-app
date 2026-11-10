import type { PropsWithChildren, ReactNode } from 'react'
import { ScanLine } from 'lucide-react'

export function WorkspaceLayout({
  children,
  actions,
  utilities
}: PropsWithChildren<{ actions?: ReactNode; utilities?: ReactNode }>) {
  return (
    <div className="app-shell">
      <header className="desktop-titlebar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <ScanLine size={18} strokeWidth={1.7} />
          </span>
          <div className="brand-copy">
            <h1>通用鉴伪系统</h1>
          </div>
        </div>
      </header>
      <div className="desktop-body">
        <aside className="app-navigation" aria-label="应用导航">
          <nav aria-label="主要功能">{actions}</nav>
          <div className="navigation-utilities">{utilities}</div>
        </aside>
        <main>
          <div className="workspace">{children}</div>
        </main>
      </div>
    </div>
  )
}
