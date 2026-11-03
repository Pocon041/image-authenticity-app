# 内容路由（ROUTER）v0.2 设计与验证

第二人模块新增：图像预处理后基于零样本 CLIP 的**内容类型路由**，自动决定检测器组合。路由只影响运行哪些检测器，不产生整图真实性或篡改结论。

## 位置与流程

```
选择图片 → 预处理（EXIF 旋转 / sRGB / PNG，产出 display.png）
        → 内容路由（auto 时）：CLIP 图像嵌入 vs 冻结文本提示 → photo / document / unsure
        → plannedDetectors(解析后的类型) 依次执行检测器
```

- 路由在 `prepareWorkflowInput` 之后、检测器调度之前运行，输入是规范显示图 `images/display.png`。
- 手动选择 photo/document/unsure 时跳过路由（`routing.mode=manual`，`status=skipped`）。
- 路由失败或低置信度（margin < 阈值）时回退 **unsure 全量**（aigc+sica+rita+rise），绝不静默跳过检测器；失败原因记录在 routing.error。

## 实现机制（无下载、无训练）

- 复用现有 SICA 权重文件 `weights/sica/*.pth`：其中已包含完整 base CLIP ViT-L/14（48 个 `parametrizations.*.original` 基础注意力权重 + 完整文本塔）。
- 加载器按键映射剥离 LoRA（A/B/row_mask）与 SICA 分类头，重建官方 CLIP 架构并 strict 加载（446 个基础键，122 个排除键，missing/unexpected 为空）；前向不应用 LoRA。
- CLIP 源码复用固定版本 `.tools/openai-clip`（commit `d05afc43`，manifest 校验）；Python 环境复用 EIT（torch 2.7.0+cu126），不新增依赖。
- 输入预处理与 SICA 相同：官方 CLIP 短边缩放 224 + 中心裁剪。

## 决策规则

提示词在 [worker.py](../backend/router/worker.py) 中冻结：

- photo：`a photograph` / `a photo of a real-world scene` / `a camera photo of people, objects or scenery` / `a natural image`
- document：`a document` / `a screenshot of text` / `a scanned document or form` / `a receipt or invoice with printed text`

对所有提示词的 logits 做一次 softmax，按组求和得到 `photoScore` / `documentScore`，`margin = |photoScore - documentScore|`：

- `photoScore - documentScore >= marginThreshold` → photo（aigc+sica+rita）
- `documentScore - photoScore >= marginThreshold` → document（aigc+sica+rise）
- 否则 → unsure（全量）

**冻结阈值 `marginThreshold = 0.15`**（`config/router.example.json`），选择依据见下节验证。

## 离线验证（work/router-validation-20261103/）

- 清单：CASIA 本地子集 479 张照片 + 用户票据/短信文档样例 2 张 = 481 张，全部评估成功。
- 阈值扫描（正确 / unsure / 照片误判为文档 / confident 准确率）：

| 阈值 | 正确 | unsure | 照片误判为文档 | confident 准确率 |
|---|---|---|---|---|
| 0.05 | 464 | 4 | 13 | 97.3% |
| 0.10 | 461 | 9 | 11 | 97.7% |
| **0.15** | 458 | 13 | 10 | **97.9%** |
| 0.20 | 457 | 15 | 9 | 98.1% |

- 2 张文档样例均正确判为 document（margin ≈ 1.0 / 0.98）。
- 重要观察：照片误判为文档的样例中约 4 例 margin > 0.9（CLIP 对书页/海报类照片的"文档相似度"很高），阈值无法消除这类误判。document 路由因此跳过 RITA 时，约有 2–3% 的照片会缺少 RITA 定位。**用户已确认接受该权衡**（2026-11-03），保留「document → 只跑 RiSE」的省时设计。
- 验证局限：文档样例仅 2 张，document→photo 方向的误判率未被充分测量；清单标签为内容类型，不涉及篡改真值；验证用 PIL EXIF 转置 + RGB，与 APP 的 sharp sRGB 管道近似但不等同。规则在验证集上选择并冻结，独立数据上的评估留待后续。

## 证据与透明度

- 每任务保存 `work/analysis-runs/<taskId>/router/routing.json`（决策、分数、margin、提示词、权重/源码审计、耗时）。
- `run.json` 记录 `selection`（用户选择）、`contentType`（解析后类型）与 `routing`。
- bundle 的 manipulation 报告 `result.routing` 与简明摘要 `analysis.json` 的 `routing` / `contentType` 字段同步记录。
- UI 报告页显示自动路由判定与照片/文档相似度百分比，并注明「路由只决定检测器组合，不构成篡改结论」。

## 红线与限制

- 不训练、不下载任何新权重或依赖；只用现有 SICA checkpoint 与固定 CLIP 源码。
- 路由不否决定位、不参与真实性判定；SICA 阴性不否决定位的原则不变。
- 路由失败绝不静默：回退全量并记录失败原因。
- 内容相似度不是校准概率；短边缩放+中心裁剪可能忽略边缘内容。
- 未做独立测试集评估；文档误判方向样本不足。

## 检查命令

- Python 单元测试（含真实重建加载）：`<EIT Python> -m unittest backend/router/test_loader.py`（工作目录 `backend/router`）
- 离线验证：`<EIT Python> backend/router/evaluate.py --config config/router.local.json --manifest <清单> --output <目录>`
- 编排：`run.cmd run test:workflow`；真实联合链路：`smoke:workflow -- --image <path> --software-rendering`
