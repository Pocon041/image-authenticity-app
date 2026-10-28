import type { PropsWithChildren } from 'react'
import { LockKeyhole, ShieldCheck } from 'lucide-react'

export function WorkspaceLayout({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <main>
        <header className="topbar">
          <strong>图像真实性分析</strong>
          <span className="local-badge">
            <LockKeyhole size={13} />
            本地处理 · v0.2.0
          </span>
        </header>
        <div className="workspace">
          {children}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={14} />
              图片仅在本机处理
            </span>
            <span>视觉证据报告</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
