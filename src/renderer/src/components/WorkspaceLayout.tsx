import type { PropsWithChildren, ReactNode } from 'react'
import appIcon from '../../../../build/icon.svg?url'

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
              <img src={appIcon} width={20} height={20} alt="" draggable={false} />
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
