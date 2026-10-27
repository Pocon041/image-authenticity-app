import type { PropsWithChildren } from 'react'
import { ChevronRight, Focus, Layers, LockKeyhole, ScanLine, ShieldCheck } from 'lucide-react'

export function WorkspaceLayout({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Focus size={25} />
          </div>
          <div>
            <strong>图像分析</strong>
            <span>本地真实性分析工作台</span>
          </div>
        </div>
        <div className="sidebar-label">工作空间</div>
        <div className="nav-item active" aria-current="page">
          <ScanLine size={18} />
          <span>图像分析</span>
          <ChevronRight size={15} />
        </div>
        <div className="sidebar-note">
          <Layers size={17} />
          <div>
            更多能力逐步接入<span>当前为工程原型阶段</span>
          </div>
        </div>
        <div className="sidebar-footer">
          <div>
            <span className="status-dot" />
            本地运行
          </div>
          <p>图片在本机处理</p>
          <small>DESKTOP · v0.1.0</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            工作空间 <ChevronRight size={14} />
            <span>图像分析</span>
          </div>
          <span className="local-badge">
            <LockKeyhole size={13} />
            本地桌面应用
          </span>
        </header>
        <div className="workspace">
          {children}
          <footer className="workspace-footer">
            <span>
              <ShieldCheck size={14} />
              本机处理 · 无远程 API 调用
            </span>
            <span>第一阶段 / 本地图像分析</span>
          </footer>
        </div>
      </main>
    </div>
  )
}
