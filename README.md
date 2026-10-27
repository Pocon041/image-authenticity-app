# image-authenticity-app

本地图像真实性分析桌面应用。项目侧重工程集成，目标是把 AI 生成检测、局部篡改定位和有证据支撑的解释整合到同一个桌面工作台。

**当前阶段：先跑通工程框架，所有分析均为模拟。** 没有接入检测模型、语言模型或远程 API，不提供真实的真假判断、检测分数或篡改热图。

## 已经搭好的主流程

选择本地图片 → 图片预览 → 启动模拟任务 → 接收进度 → 展示固定模板描述。

当前包含：

- 中文桌面工作台，使用系统原生文件选择对话框。
- 单张 PNG / JPEG / WebP 导入、图片有效性检查、分辨率与文件大小展示。
- 具有进度通知、重复任务保护和取消能力的模拟分析任务。
- 模拟描述展示；更换图片时清除旧结果，取消选图时保留现有内容。
- 独立的桌面主进程、界面组件、任务状态管理、共享类型和分析服务接口。
- 真实 Electron 窗口中的端到端 Smoke 验证。

图片和结果只保留在当前会话，不写入历史数据库，不修改原图。运行时不上传图片；开发模式会访问本机 Vite 服务。

## 技术框架

- **Electron**：桌面窗口、文件访问和应用生命周期。
- **React + TypeScript**：工作台界面与交互。
- **electron-vite / Vite**：主进程、preload 和界面的开发与构建。
- **sharp**：图片解码、方向校正和预览生成，不执行真实性检测。
- **Playwright**：在真实桌面窗口中操作主流程。
- **electron-builder**：生成 Windows 应用目录，发布流程后续完善。

未来如果接入 Python 推理，由主进程的服务适配层管理；界面不直接运行 Python，也不直接访问文件系统。

## 从零复现启动（Windows）

当前验证环境为 **Windows 10/11 x64**。这是源码开发版本，克隆后需要安装依赖才能运行；当前不需要 Python、CUDA、GPU、模型权重或 API Key。

### 1. 安装环境

- 安装 [Git for Windows](https://git-scm.com/downloads/win)。
- 安装 [Node.js 24 LTS](https://nodejs.org/en/download)，npm 随 Node.js 一起安装。项目最低要求 Node 22.12，但推荐统一使用 Node 24 LTS。
- 安装完成后重新打开 PowerShell，确认以下命令可用：

```powershell
git --version
node --version
npm.cmd --version
```

首次安装需要能访问 npm 包仓库以及 GitHub 的 Electron Releases 下载地址。完成依赖和运行时安装后，当前模拟分析流程在本机执行。

### 2. 克隆并启动

在希望保存项目的目录打开 PowerShell，依次运行：

```powershell
git clone https://github.com/Pocon041/image-authenticity-app.git
cd image-authenticity-app
npm.cmd ci
npm.cmd run dev
```

- `npm.cmd ci` 根据仓库内的 `package-lock.json` 安装锁定版本的依赖。
- `npm.cmd run dev` 先检查 Electron 运行时；缺少时自动从官方发布地址下载并校验 SHA256，然后启动桌面窗口。
- 首次运行会有下载等待，终端显示 `starting electron app...` 后应出现独立的中文桌面窗口。
- 终端显示的 `http://127.0.0.1:5173/` 是桌面界面的本机开发服务地址。正常使用入口是自动打开的桌面窗口。

Windows 示例统一使用 `npm.cmd`，以避免 PowerShell 对 `npm.ps1` 的脚本执行策略限制；在命令提示符中也可以使用 `npm`。

### 3. 验证主流程

在桌面窗口中：

1. 点击“选择图片”，导入一张 PNG、JPG 或 WebP 图片，文件不超过 20 MB。
2. 确认左侧出现图片预览、分辨率和文件大小。
3. 点击“开始模拟分析”，观察进度变化。
4. 大约 1.5 秒后，右侧应出现“模拟分析已完成”和固定模板描述。
5. 可以继续尝试取消分析、重新分析、更换图片和清空图片。

所有结果都标注为模拟内容，不代表对图片真实性的实际检测。

关闭桌面窗口即可结束当前 Electron 应用；若终端中的开发服务仍在运行，使用 Ctrl+C 结束。保留启动终端，不要在使用过程中直接关闭它。

### 4. 后续双击启动

完成 Node.js 安装并克隆仓库后，可以双击根目录的 `start.cmd`。脚本在依赖缺失时执行 `npm ci`，随后启动相同的开发流程。

也可以在 PowerShell 中运行：

```powershell
.\start.cmd
```

项目无需放在固定盘符或目录，`start.cmd` 会自动切换到自身所在的项目目录。仓库不包含本机的 `.tools/` 或 `node_modules/`；其他使用者只需安装前面列出的 Node.js 和 Git。

### 5. 自动化复现检查

在项目根目录执行：

```powershell
npm.cmd run typecheck
npm.cmd run smoke:startup
npm.cmd run smoke
```

- `typecheck`：检查 TypeScript 类型。
- `smoke:startup`：实际调用 `start.cmd`，确认启动钩子、Electron 窗口、React 页面与桌面桥接可用。
- `smoke`：构建后启动真实 Electron，验证选图、模拟分析、取消和结果展示等流程。

测试会自动关闭窗口，结果保存在 `work/startup/` 和 `work/smoke/`。执行自动化测试前，请先关闭本项目的开发服务，以免占用 5173 端口。

### 常见启动问题

- **Node 版本不满足要求或找不到命令**：安装 Node.js 24 LTS，并重新打开终端后运行 `node --version` 确认。
- **提示 npm.ps1 无法执行**：改用本文的 `npm.cmd` 命令，无需修改系统执行策略。
- **提示 `Electron uninstall` 或运行时下载失败**：检查能否访问 GitHub Releases，然后运行下面的修复命令，再启动应用：

  ```powershell
  npm.cmd run runtime:ensure -- --repair
  npm.cmd run dev
  ```

- **提示 5173 端口被占用**：先回到上一次启动项目的终端，用 Ctrl+C 结束旧的开发服务，再启动本次应用。

Electron 45 采用延迟下载运行时的方式，因此只完成 `npm ci` 不一定已经下载桌面可执行文件。项目通过 `predev` / `prestart` 自动补齐。Windows 下载与解压使用自带的 PowerShell 模块，已验证的官方 ZIP 缓存在 `work/electron-cache/`，重装 npm 依赖后可以复用。

`run.cmd` 是 Windows 下的辅助入口，优先使用可选的 `.tools/` 本地 Node，否则使用系统 Node。它与直接调用 npm 的开发命令等价，例如 `.\run.cmd run dev`。在新电脑上按上述步骤安装系统 Node 即可，不依赖开发者的本地环境。

## 项目结构

```text
image-authenticity-app/
├─ AGENT.md                         项目约定、范围、开发方式和当前状态
├─ AGENTS.md                        自动发现入口，指向 AGENT.md
├─ README.md                        项目说明和使用入口
├─ electron.vite.config.ts          桌面开发与构建配置
├─ package.json / package-lock.json 运行命令与依赖锁定
├─ start.cmd / run.cmd              Windows 启动入口
├─ scripts/                         Electron 运行时检查与下载
├─ src/
│  ├─ main/
│  │  ├─ index.ts                   窗口与应用生命周期
│  │  ├─ ipc.ts                     桌面 IPC 路由与参数检查
│  │  ├─ errors.ts                  统一错误类型和响应
│  │  ├─ image-import.ts            本地图片读取、解码和预览
│  │  └─ services/
│  │     ├─ analysis.ts             AnalysisService 接口与模拟实现
│  │     └─ analysis-session.ts     当前图片、任务互斥、取消与释放
│  ├─ preload/
│  │  └─ index.ts                   最小范围的桌面桥接 API
│  ├─ shared/
│  │  └─ contracts.ts              图片、报告、进度和错误协议
│  └─ renderer/
│     ├─ index.html                页面入口与内容安全策略
│     └─ src/
│        ├─ App.tsx                工作台页面组装
│        ├─ components/            桌面布局、图片面板、结果面板
│        ├─ hooks/                 任务状态与交互逻辑
│        ├─ main.tsx               React 入口
│        └─ styles.css             工作台样式
└─ tests/
   └─ smoke.mjs                    Electron 端到端 Smoke 验证
```

生成的测试图片、截图和结果在 `work/`；构建产物在 `out/`；打包产物在 `dist/`。这些目录都不提交。

## 模块怎么协作

界面通过 `window.desktop` 调用 preload，preload 将请求交给主进程的 IPC 路由。主进程读取图片并管理分析会话，再调用 `AnalysisService`。结果和进度沿原路径返回界面。

跨进程协议统一定义在 `src/shared/contracts.ts`。目前桥接层只开放五个方法：

- `chooseImage()`：原生选图，返回预览与元信息；取消时返回空值。
- `clearImage()`：释放主进程中的当前图片，并由界面清除展示内容。
- `analyze(imageId, taskId)`：运行当前图片的模拟任务，返回报告。
- `cancelAnalysis(taskId)`：请求取消指定任务。
- `onAnalysisProgress(listener)`：订阅任务进度，返回取消订阅函数。

请求结果统一使用 `ok` 区分成功与失败；失败包含稳定的错误代码和可展示的错误描述。每个任务携带独立任务 ID，界面据此过滤过期进度。主进程拒绝重复任务和失效图片 ID。

原始文件路径只保留在主进程。界面接收处理后的预览，不具备任意文件访问或任意 IPC 能力；窗口启用 contextIsolation 和 sandbox，关闭 nodeIntegration。

## 后续从哪里扩展

1. **接入检测能力**：在 `src/main/services/` 下增加 `AnalysisService` 实现，通过同一个输入、进度与取消协议调用本地服务。
2. **组织结果与证据**：扩展 `AnalysisReport` 的类型，保存模型结果、区域和证据引用，再增加结果面板组件。
3. **接入自然语言解释**：根据结构化证据生成解释，保留证据引用和运行来源。
4. **增加历史与导出**：作为独立的数据存储和报告服务接入，不把存储逻辑堆进界面。
5. **完善交付**：补充安装包、签名、更新和更多运行环境验证。

这些是后续工程接入位置，目前没有创建空壳 Python 后端、模型下载器或未实现的功能页面。

## 开发命令

```powershell
.\run.cmd run dev            # 启动开发桌面窗口
.\run.cmd run typecheck      # 类型检查
.\run.cmd run build          # 构建主进程、preload 和界面
.\run.cmd run smoke          # 构建后验证桌面流程
.\run.cmd run smoke:dev      # 通过本机开发服务验证相同流程
.\run.cmd run smoke:startup  # 验证 start.cmd 的真实启动链路
.\run.cmd run format         # 格式化源码与文档
.\run.cmd run format:check   # 检查格式
```

Smoke 测试只替代文件选择对话框，实际的文件读取、图片解码、IPC、模拟任务和 React 展示均走真实实现。测试自动关闭窗口，结果写入 `work/smoke/`。

当前框架已通过类型检查、构建和 **15 项真实 Electron Smoke 检查**，覆盖正常导入、模拟分析、进度通知、取消后重新分析、更换与清空图片等流程。该测试运行中没有观察到 HTTP 请求或 React 运行时异常。这些检查验证工程主流程，不代表任何图像检测能力。

另已通过 `smoke:startup`：实际执行 `start.cmd`，确认启动前运行时检查、electron-vite 启动、React 页面和 preload 桥接可用。结果保存在 `work/startup/`，用于覆盖直接启动 Electron 的测试无法发现的启动入口问题。

已提供以下发布相关入口，供后续完善交付流程：

```powershell
.\run.cmd run package:dir
.\run.cmd run smoke:packaged
```

`package:dir` 生成 `dist/win-unpacked/SRDP.exe` 及其依赖文件。可运行目录已生成过；打包后的完整自动化验证曾在隐藏窗口截图环节超时，尚未验收。当前优先完成开发框架，不把发布版本标记为已完成。

## 当前限制

- 每次处理一张图片，文件最大 20 MB，解码上限为 6000 万像素。
- 图片预览自动处理 EXIF 方向，最大边长为 1800 像素，原始文件保持不变。
- 模拟服务按预置阶段等待约 1.5 秒，然后返回固定模板描述；进度也属于模拟流程。
- 尚未实现真实检测、真实解释、热图、批量任务、拖放、历史记录、结果导出或安装器。
- 目前验证重点为 Windows 开发框架，其他平台和发布交付后续再做。

## 协作约定

修改项目前阅读 `AGENT.md`。改变架构、接口、运行命令或阶段范围时同步更新它；README 应始终区分已经实现的功能与未来目标。

本阶段的完成标准是：**框架分层清楚，模拟主流程可运行，后续能力有明确接入位置。**
