# SRDP Windows 安装版

## 团队内部完整包 v0.2.2

取得团队内部的 `SRDP-Research-0.2.2-win-x64.zip` 后，将整个压缩包解压到数据盘。建议为分发包、解压资源和实际运行目录合计预留至少 40 GB。压缩包中的安装器和 `runtime-bundle` 文件夹需要保持相邻。

运行 `SRDP-Setup-0.2.2-x64.exe` 完成应用安装。首次打开应用，点击“选择数据目录并自动配置”，选择一个新的数据文件夹并等待校验、展开和检查完成。用户无需单独安装 Python、Git、Node.js、Ollama 或下载模型权重。

配置过程支持取消和重试，已完整展开的组件会复用。首次配置后，用户可以移除分发包的解压目录，建议保留原 ZIP 供重装使用。需要重新指定资源时，点击“选择完整资源包”并选择其中的 `runtime-bundle`。

本地解释服务由应用管理，使用 `127.0.0.1:11435`。服务模型、临时文件和缓存位于所选数据目录。应用启动时恢复服务，退出时关闭自身启动的服务。现有用户配置继续保留，原云端接口可按配置使用。

### 硬件与空间

- Windows 10/11 x64。
- 推荐 NVIDIA GPU，至少 8 GB 显存，并安装支持 CUDA 12.x 的驱动。RTX 4060 Laptop 8 GB 已完成完整链路验证。
- 无 NVIDIA GPU 时可以使用 CPU，速度会明显变慢，CPU 吞吐没有做正式验收。
- 建议 16 GB 以上系统内存，完整科研包和多个模型同时运行时建议 32 GB。
- 完整 ZIP 约 10.36 GB，展开约 16.41 GB。数据目录还会保存配置、报告、缓存和临时文件，建议预留至少 20 GB，建议空间紧张的机器预留 40 GB。
- 本地解释服务绑定 `127.0.0.1:11435`，不需要公网端口。

资源仅用于内部非商业科研，第三方来源与许可保留在包内。构建时使用本机已经配置好的 Python、模型源文件、权重和 Ollama，校验后生成分发资源。

```powershell
# 使用config/sica.local.json指定的构建机Python收集资源并生成内部ZIP
.\run.cmd run package:research
# 显式重新收集运行环境与权重
.\run.cmd run package:research -- --rebuild-runtime
```

## 公开轻量安装版 v0.2.1

适用于 Windows 10/11 x64。运行 `SRDP-Setup-0.2.1-x64.exe`，选择安装位置，安装后从开始菜单或桌面打开“SRDP 图像真实性分析”。应用界面和 Electron 运行时随安装包提供，用户启动应用无需安装 Node.js。

## 首次启动

打开“本地运行环境”，选择模型与报告目录。建议放在空间充足的数据盘，例如 `D:\SRDP-Data`。目录中的配置、权重和分析结果在应用升级及卸载后保留。

已经按项目 README 配置过源码版的用户，可以直接选择已有项目根目录，例如自己的 `D:\SRDP`。相对模型路径和配置继续以这个目录为基准。安装版使用随程序提供的 Python 后端脚本。

新建目录时，应用会提供 `config/*.example.json` 和本说明。配置模板用于参考，准备好环境后复制为相应的 `*.local.json`，填写本机 Python、模型源码及权重路径。“已找到配置”仅表示存在配置文件，实际可用性在分析时检查。

## 推理环境

内部完整包已包含应用、本项目 Python 后端、独立 Python 环境、第三方模型源码、官方权重、OCR 和 Ollama。用户不需要单独安装 Python、Git、Node.js 或 Ollama，也不需要联网下载模型。首次自动配置会进行资源哈希校验、解压和导入检查。

公开轻量安装版只包含应用和本项目 Python 后端。使用公开轻量安装版时，Python 解释器、推理依赖、第三方模型源码、官方权重和 Ollama 模型需要按 README 另外准备。

完整步骤和官方下载链接见项目 README。

https://github.com/Pocon041/image-authenticity-app#readme

可以先按 README 在选定目录准备模型环境，再用安装版连接该目录。模型配置通常包括以下文件。

- `config/sica.local.json`，设置 Python、SICA/CLIP 源码和权重。
- `config/rita.local.json`，设置 Python、RITA 源码和权重。
- `config/rise.local.json`，设置 Python、RiSE 源码、隔离依赖和权重。
- `config/aigc.local.json`，设置 FSD 环境与权重目录。
- `config/router.local.json`，使用已有 SICA 权重与 CLIP 源码。
- `config/explanation.local.json`，设置本地 Ollama 地址和实际模型标签。

元数据、C2PA 和水印解析使用所选目录中的 `.venv/Scripts/python.exe`。按 README 执行 `provenance:setup` 准备。各检测器也支持在配置中使用其他位置的 Python 和权重绝对路径。

## 使用与报告

选择图片后运行联合分析。模型缺失或执行失败会显示对应状态，可以在“开发与单模型调试”中选择明确标记的模拟流程检查图像导入和界面。

报告保存在所选目录的 `work/analysis-runs/<任务编号>/`，包含简明报告、完整证据包、来源报告、定位产物和解释。应用内可打开当前报告文件夹。

## 升级和卸载

新安装包可以覆盖升级应用。模型与报告目录独立管理，升级沿用已保存的目录选择。卸载应用后，模型、配置和报告仍保存在用户选择的目录。

此版本未使用商业代码签名证书，Windows 可能显示未知发布者。请从本项目 GitHub Releases 下载，并使用发布页的 SHA-256 校验文件核对安装包。
