# SRDP 项目开发约定

GitHub 仓库名采用 `image-authenticity-app`，中文项目名称为“图像真实性分析桌面应用”。本地开发目录保留 `D:\SRDP`。
远程仓库为 `https://github.com/Pocon041/image-authenticity-app`，主分支为 `main`。

## 项目目标与当前范围

开发基于本地推理的图像真实性分析桌面 APP。本项目侧重工程集成，不开发视觉取证算法。

当前阶段只实现端到端 Smoke 闭环：选择本地图片 → 预览 → 模拟分析 → 显示模拟描述。
不接入检测模型、语言模型、远程 API 或真实推理。模拟内容必须始终明确标注，不能展示伪造的真实检测结论或置信度。

## 维护要求

- 本文件是项目约定的唯一正文。每次改变框架、目录、运行命令、接口或阶段范围时，同步更新本文件。
- 每次交付前更新“当前状态”，记录已实现内容、实际验证结果和已知限制，不将计划记为完成。
- 用户的新要求优先于这里已有的约定。

## 架构

- Electron 主进程：本地文件选择、图片检查、分析服务调用和应用生命周期。
- React + TypeScript 渲染进程：中文界面、预览、交互和结果展示。
- preload：通过 contextBridge 暴露最小范围的类型化 IPC 接口。
- 分析服务：用统一接口隔离模拟实现；未来再替换为本地推理适配器。
- `AnalysisSession` 管理当前图片、互斥任务和取消；模拟服务经回调报告任务进度。
- 主进程保留原始文件路径，界面只接收预览 DTO。界面组件与 `useAnalysisWorkspace` 交互状态分开。
- 跨进程调用统一使用结果响应与稳定错误代码，进度携带任务 ID，监听器必须可取消订阅。
- 当前没有 Python 服务；不要为未来模型预先引入推理依赖或空壳后端。
- 渲染进程禁止直接访问 Node.js、文件系统或任意 IPC。启用 contextIsolation 和 sandbox，关闭 nodeIntegration。

## 目录职责

- `src/main/`：桌面主进程、文件导入和分析服务。
- `src/preload/`：桌面桥接白名单。
- `src/renderer/`：React 工作台与样式。
- `src/shared/`：跨进程数据协议。
- `tests/`：真实 Electron 窗口的端到端 Smoke 验证。
- `scripts/`：运行时检查和安装；Windows 从官方发布地址下载 Electron，并按 npm 包提供的 SHA256 校验。
- `.tools/`：可选的项目本地 Node 环境，不提交。
- `work/`：生成的测试图、截图和临时文件，不提交。
- `out/`、`dist/`：构建产物，不提交。

## 开发与验证

Windows 启动入口为 `start.cmd`；`run.cmd` 负责优先使用 `.tools/` 下的 Node。

- `run.cmd install`：首次安装依赖；有锁文件时优先用 `run.cmd ci`。
- `run.cmd run dev`：启动开发桌面窗口。
- `run.cmd run typecheck`：TypeScript 检查。
- `run.cmd run build`：构建主进程、preload 和渲染进程。
- `run.cmd run smoke`：构建并运行真实 Electron 端到端测试。
- `run.cmd run smoke:dev`：在本机 Vite 开发服务上验证相同的桌面交互。
- `run.cmd run smoke:startup`：实际调用 `start.cmd`，验证 npm 生命周期、electron-vite 和桌面界面；不以 Playwright 直接启动 Electron 来替代。
- `run.cmd run runtime:ensure`：检查 Electron 可执行文件、版本与 `path.txt`，缺失时安装；`predev` 和 `prestart` 自动调用。
- `run.cmd run runtime:ensure -- --repair`：重新校验下载包并修复运行时，优先复用缓存；安装子进程使用 Windows 自带 PowerShell 模块路径。
- `run.cmd run package:dir`：生成 Windows 可直接运行的应用目录。
- `run.cmd run smoke:packaged`：打包并对 `dist/win-unpacked/SRDP.exe` 执行相同的 Smoke 验证。
- `run.cmd run format` / `format:check`：统一源码与文档格式。

使用 `package-lock.json` 固定依赖。需要 Node 22.12+，推荐 Node 24 LTS。不要修改系统 Node 来满足本项目。
修改跨进程协议或核心交互后执行类型检查和主流程 Smoke 测试。Smoke 测试只模拟文件选择对话框，实际文件读取、解码、IPC、模拟分析和 React 展示均走真实应用路径。

用户明确要求当前优先搭建并跑通大框架；具体 Bug、打包截图和交付细节先记录，避免偏离主流程。后续独立安排真实能力与发布验收。

## 当前状态

- 桌面框架、类型化 IPC、图片导入和模板分析主流程已建立。
- 已拆分界面组件、界面任务状态、主进程 IPC 路由与分析会话，具备进度、取消和主进程图片释放能力。
- 当前版本已通过 TypeScript 检查、生产构建和 15 项真实 Electron Smoke 检查，包括取消后重试；没有观察到 HTTP 请求或 React 运行时异常。
- 已修复首次双击启动出现 `Electron uninstall`：Electron 45 延迟下载运行时，而 electron-vite 只检查 `path.txt`。已加入 `predev` / `prestart` 安装钩子、官方包 SHA256 校验、缓存和修复命令；已实际通过 npm 执行运行时修复，并通过真实 `start.cmd` 启动测试，确认界面和 preload 桥接就绪。
- 使用 sharp 做实际图片解码、EXIF 方向校正及最大边长 1800 像素的预览，不修改原始文件；这不属于取证算法。
- README 已按 `image-authenticity-app` 重写，包含结构、协作边界、启动命令和后续接入位置。
- README 的复现步骤以新电脑和全新克隆为准，包含 Git / Node 24 LTS 安装、克隆地址、`npm.cmd ci`、启动、手动验收、自动化检查和常见启动问题；不依赖开发者本机的 `.tools/`。
- Windows 应用目录已生成过，打包后测试曾在隐藏窗口截图步骤超时；暂未通过发布验收，本轮不继续追查此具体问题。
- 后续模型接入、真实检测、证据解释、历史记录和安装器不属于本轮范围。
