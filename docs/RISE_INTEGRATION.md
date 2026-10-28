# RiSE-9 RGB 文档定位

APP默认通过联合流程调用RiSE，也可在底部开发调试中选择「RiSE 文档定位」。它对导入图片执行真实的本地像素定位，保留模拟、RITA、SICA调试入口；HiFi-Net已移除。此模式不执行OCR、VLM或SICA门控。

## 模型与来源

- 官方代码：<https://github.com/KahimWong/RiSE>，固定提交 `83c1c2fc86eeb31ee2c50155e09826bdb780be1f`。
- 官方任务权重：<https://huggingface.co/Jason37437/RiSE/tree/main> 中的 `RiSE-9.pth`，使用 RGB 九专家版本。
- 文件大小：1,401,582,675 字节；SHA256：`dd7f28ffb9c68080bc26553b725140996315627ea43d711a94e8e522d10e282e`，与作者发布的 `checksums.json` 一致。
- 868 项模型状态严格加载，缺失、多余、形状不匹配均报错；只接受完整 RGB 任务权重。
- 本项目不重新分发上游代码、模型权重或样例图片。上游代码和骨干模型的使用条款应分别遵守。

## 本机运行

当前本机权重为 `D:\SRDP\weights\RiSE\RiSE-9.pth`，配置位于 Git 忽略的 `config/rise.local.json`。直接双击 `start.cmd`，导入图片，选择「RiSE 文档定位」，点击「开始 RiSE 定位」。

首次在其他机器准备源码：

```powershell
.\run.cmd run rise:setup
```

此命令只准备固定版本源码并核对文件校验值，不下载权重或安装 Python 包。需要 Git 能正常访问 GitHub；若 Git 配有失效代理，修正本机代理配置后重试。

Python 环境需要 PyTorch、torchvision、timm、NumPy、Pillow 和 OpenCV。当前实测宿主为 Python 3.13.2、torch 2.7.0+cu126、torchvision 0.22.0、timm 1.0.21。它不是上游 requirements 的完整原始环境，结果不称为论文复现。

RiSE 专用新增包隔离安装，避免改变现有模型环境：

```powershell
<你的Python> -m pip install --no-deps --target .tools/rise-deps-v5 -r backend/rise/requirements-isolated.txt
```

其中 Transformers 固定为上游要求的 5.7.0；宿主还需具备其常规依赖，如 filelock、fsspec、packaging、PyYAML、tqdm、typing-extensions、httpx、typer、safetensors。上面的 `--no-deps` 命令不会替你安装这些宿主依赖。

将 `config/rise.example.json` 复制为 `config/rise.local.json`，设置 `pythonPath` 为实际 Python 可执行文件；权重、源码与依赖目录可使用相对项目根目录的路径。默认 `device=cuda:0`，也允许显式设置 `cpu`，但本轮未验证 CPU 性能。

## 输入、推理与报告

原文件按原字节复制到任务目录，SHA256 作为统一 imageId。显示副本为 EXIF 校正方向、sRGB、未缩放的 PNG。RGB 模式直接使用 PNG/JPEG/WebP 的解码像素，不重编码为 JPEG，不进行 OCR、锐化或超分辨率。

官方单图接口要求预裁剪的 512×512 图像。本适配器以 512×512 图块、默认步长 384 覆盖完整显示图；右下边界补齐最后一块。尺寸不足 512 的方向只在右/下以边缘像素填充，不改变原图尺寸。九专家按官方 `sequential` 模式运行，保留官方 CUDA FP16 autocast、FP32 ADF、五阶积分、noise variance 0.5 和无真值 LPC 选择。重叠位置的像素响应取均值，最后按 0.5 生成掩码；这是工程分块策略，与论文预裁剪输入协议不同。

`maxTiles` 默认 128，超过上限明确报错，不静默跳过部分图片；超时默认十分钟，支持取消实际 Python 子进程。缺少源码、权重或依赖时明确报错，不回退到模拟结果。

完整任务权重已经包含骨干参数。`backend/rise/backbone/config.json` 仅描述网络结构，用于离线构造模型，再由任务权重覆盖全部状态；不另行下载 DINOv3 权重。结构参数参照 Meta 公开的 [ViT-L/16 架构](https://github.com/facebookresearch/dinov3/blob/main/dinov3/hub/backbones.py) 和 Transformers 实现，非从受限仓库下载的文件。加载和推理设置 `HF_HUB_OFFLINE`、`TRANSFORMERS_OFFLINE`，不调用网络模型服务。

每次结果保存在 `work/rise-runs/<taskId>/`，包含：

- 原文件与规范显示副本。
- 全尺寸 `artifacts/mask.png`、`response.png`、`overlay.png`。
- `response.float32.npy`：原尺寸浮点响应，避免只保留8位预览而损失数值精度。
- 最多20个最大连通区域的裁剪及规范像素坐标；完整掩码保留全部区域。
- `report.json` 与 `bundle.json`：沿用 v1.0 协议，含模型、源码、权重、依赖、每块位置和专家选择记录。浮点响应文件在 extensions 中记录 URI、哈希与数据类型。

像素响应和 LPC 专家选择分数都不是图像真实性置信度。图像级 `decision` 保留 `inconclusive`，允许“标记了区域，但未给出整图分类结论”。没有识别篡改手法，不将专家编号映射为操作名称。

## 命令与验证

```powershell
.\run.cmd run rise:infer -- --image <图片完整路径>
.\run.cmd run examples:validate -- --bundle <输出目录>/bundle.json
.\run.cmd run smoke:rise -- --image <图片完整路径>
<配置的Python> -m unittest discover -s backend/rise -p test_*.py
```

CLI 默认结果位于 `work/rise-cli/<随机ID>/`，可用 `--output` 指定新目录；APP 任务目录与 CLI 目录分开。Electron 在特定机器发生 GPU 渲染启动问题时，测试命令可追加 `--software-rendering`，只对测试进程禁用 GPU 渲染，模型仍使用 CUDA；不关闭应用 sandbox。

本轮两张用户样例的结果另见 [RISE_EVALUATION.md](./RISE_EVALUATION.md)。这些样例用于接入观察，不构成跨域泛化、准确率或误报率基准。
