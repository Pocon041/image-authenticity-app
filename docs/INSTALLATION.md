# SRDP Windows 安装说明

## 下载和启动

从 GitHub Releases 下载当前版本的 SRDP-Setup-0.2.2-x64.exe，运行安装向导并选择安装位置。应用界面和 Electron 运行时随安装包提供，启动应用不需要 Node.js。

首次启动时，在“本地运行环境”中选择保存配置、模型路径和报告的目录。已经配置过源码版环境的用户可以直接选择项目根目录。

## 硬件要求

- Windows 10 或 Windows 11，64 位。
- 推荐 NVIDIA GPU，至少 8 GB 显存，并安装支持 CUDA 12.x 的驱动。RTX 4060 Laptop 8 GB 已完成完整检测和本地解释链路验证。
- 没有 NVIDIA GPU 时可以使用 CPU，速度会明显变慢。CPU 吞吐和大批量处理没有做正式验收。
- 建议至少 16 GB 系统内存，多个检测模型和本地 VLM 同时使用时建议 32 GB。
- 应用和 Python 环境建议预留至少 10 GB。下载权重、依赖和模型缓存后，建议预留 20 GB 以上。

## 准备真实模型

公开安装包不包含第三方模型权重和完整 Python 环境。运行真实检测时，需要准备以下内容：

- Python 3.13 和与本机 GPU 匹配的 PyTorch。
- SICA、RITA、RiSE 和 FSD 的固定版本源码与官方权重。
- 来源检查所需的 C2PA、RapidOCR、OpenCV 和 PyWavelets 环境。
- 本地 Ollama 与 Qwen3-VL-2B-Instruct 模型。

完整准备步骤、模型下载入口和配置模板见项目 README。模型和权重不会提交到 GitHub，第三方组件按照各自许可使用。

## 本地 VLM

默认使用本机 Ollama。准备好模型后执行：

    ollama serve
    .\run.cmd run explanation:setup -- --model srdp-qwen3-vl-2b

默认地址是 http://127.0.0.1:11434。应用不会在解释过程中静默联网下载模型。

## 报告和数据

报告保存在所选目录的 work/analysis-runs/<taskId>/。其中包括 analysis.json、bundle.json、来源报告、模型报告、掩码、响应图、区域裁剪和最终解释。应用升级与卸载不会删除用户选择的模型、配置和报告目录。

## 开发者构建

    .\run.cmd run package:win

安装包输出到 dist/v<版本>/，同时生成 SHA256SUMS.txt。测试入口见 README 的“开发与验证”部分。

当前安装包没有代码签名证书，Windows 可能显示未知发布者。\n