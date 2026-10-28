# SICA 图像二分类接入

SICA 作为独立的图像级真假初筛，不生成掩码，不确认局部篡改类型，也不调用 VLM。原有模拟与 RITA 定位模式保留，界面可以分别选择。

## 环境与源码

依照现有 README 配置 Node/npm。使用带 PyTorch、torchvision 的 Python，其他依赖见 `backend/sica/requirements.txt`。

```powershell
python -m pip install -r backend/sica/requirements.txt
npm.cmd run sica:setup
Copy-Item config/sica.example.json config/sica.local.json
```

`sica:setup` 获取固定官方源码及 CLIP 源码，并记录校验值，不下载权重或安装 Python 包。源码保存在被 Git 忽略的 `.tools/`。SICA 源码提交为 `def6e344ca3f18a2313adb6be3bd1f8fb8d27e7d`；CLIP 源码提交为 `d05afc436d78f1c48dc0dbf8e5980a9d471f35f6`。

本机使用现有 EIT Python，不修改它的包。通过本地 CLIP 源码导入，无需向该环境安装另一个 CLIP 包。各成员的 Python、数据和权重路径可以不同。

## 权重与配置

使用[官方仓库](https://github.com/venus-guangjian/SICA_OpenMMSec)提供的权重，放入 `weights/sica/`，并编辑 `config/sica.local.json`：

- `pythonPath`：本机 Python 可执行文件，或 PATH 中的 `python`。
- `upstreamPath`、`clipSourcePath`：固定源码目录，默认值对应 setup 的输出。
- `checkpointPath`：权重路径。
- `checkpointSha256`：完整小写哈希，或 `null`。本机已经固定用户所下载文件的实际哈希，用来检查一致性，不冒充作者公布的签名。
- `checkpointVariant`：`train`、`full` 或 `unknown`，如实记录来源。
- `device`：`auto`、`cpu` 或 `cuda`。
- `threshold`：默认 0.5，本轮观察不拟合阈值。
- `timeoutMs`：默认 180000，最大 600000。

相对配置路径相对于项目根目录，本机配置及权重不提交 Git。模板优先使用 `train` 权重；用户当前下载的是 `sica_weight_full.pth`。作者说明 full 使用过 OpenMMSec 的完整训练、验证、测试数据，因此不能将有关数据上的结果作为独立泛化评测。

## 完整加载核验

适配器从完整 checkpoint 构造 ViT-L/14 骨干，不额外联网下载另一份基础 CLIP 权重。以 `strict=True` 完整加载 568 个状态项，包括 48 个 LoRA 模块和二分类头，缺失项和多余项都必须为空。未完整加载时拒绝推理。

PyTorch 读取使用 `weights_only=True`，仅为官方 checkpoint 中的 `argparse.Namespace` 添加对应的显式类型许可。推理使用 FP32；记录模型、源码、权重哈希与预处理方式。

当前核对的文件大小为 1725248247 字节，实际 SHA256 为 `edec757f9def0c5d18907087dd97e7dddbc673c804f7ff93b2d65130b3c813b9`，epoch 字段为 9。

## 运行入口

```powershell
npm.cmd run sica:infer -- --image <本机图片路径>
npm.cmd run dev
```

APP 中选择“SICA 图像二分类”，导入图片后点击“开始 SICA 二分类”。它显示原始 sigmoid 分数与阈值判断，分数未在本项目校准，不能直接解释为可信的真实性概率。

单图命令支持 `--config` 与 `--output`。APP 结果在 `work/sica-runs/<taskId>/`；命令默认在 `work/sica-cli/`。原始字节、规范显示副本、`report.json`、`bundle.json` 与本地请求分别保存。

报告复用第二人 `manipulation` 外层，但 `classification.scope=general_image_authenticity_not_tamper_only` 明确说明它是通用真假检测。`regions` 为空，`localization.status=not_run`，没有伪造定位输出。报告不能据此确认是 AI 生成、局部编辑或某种具体手段。后续公共汇总器需要保留这一边界。

## 预处理边界

当前严格沿用官方单图入口的 CLIP 预处理：短边缩放为 224，再中心裁剪 224×224，最后标准化。这与把整张图片直接拉伸到正方形不同，可能裁掉边缘的篡改区域。

本轮没有通过比较测试集结果来挑选预处理版本，也没有根据测试结果调阈值。如果后续修改成全图缩放、多裁剪等策略，应作为另一套方法单独验证并记录。

## CASIA v2 本地观察

按用户要求，已使用本地可用子集全部 479 张图片（96 张真实、383 张篡改），保持输入文件只读。没有错误或跳过；阈值固定为 0.5。

- 正确检出篡改 307 张，漏检 76 张。
- 正确识别真实 87 张，误报 9 张。
- 准确率 82.25%，平衡准确率 85.39%。
- Precision 97.15%，Recall 80.16%，F1 87.84%，AUROC 0.9239。
- 拼接 130 张检出 118 张，检出率 90.77%。
- 复制移动 253 张检出 189 张，检出率 74.70%。

这是本地子集的效果观察，不是完整 CASIA v2 基准，也不保证独立于模型训练来源。输入包含本地 train/validation/test 三份清单，划分名称只用于追溯；不能把它们当作针对已下载 full 模型重新建立的独立测试保证。

记录为 `work/sica-casia-observation/summary.json`、`predictions.csv`、`errors.json`。复现命令：

```powershell
<配置的Python> backend/sica/evaluate.py --casia-root <本机CASIA划分清单目录> --output work/sica-casia-observation-new
```

`--casia-root` 指向包含 train/validation/test_manifest.json 的目录，而不是仅含 Au/Tp 的图片目录。脚本读取清单中的实际路径；其他机器先准备自己的清单路径，不要求共享盘符。

## 检查入口

```powershell
python -m unittest discover -s backend/sica -p test_*.py
npm.cmd run smoke:sica
npm.cmd run examples:validate -- --bundle <输出目录>/bundle.json
```

桌面 Smoke 检查实际 Python、完整权重、分类展示、缺权重报错和子进程取消，只有文件选择对话框被替代。现有材料包默认用于示例路径，可通过 `smoke:sica -- --image <路径>` 指定自己的图片。

现阶段SICA用于源码开发模式，默认由联合流程调度；独立入口位于底部开发调试区。发布包的Python/权重分发未配置，FakeShield未接入，HiFi-Net运行代码已移除。基础版增量升级步骤见根目录README。
