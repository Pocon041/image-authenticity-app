# 第一阶段材料包使用说明

本轮按类型少量取样，供四人开始开发。APP 的配置和启动继续按项目根目录现有 README 执行；本轮没有修改 README。

## 内容

本机材料目录为 `examples/stage1-materials/`，共 12 张原文件：

- CASIA：原始照片、异源拼接、同源复制移动各 1 张。
- IMD2020：Yu2018 生成式修复图和对应原图各 1 张。
- GenImage-Tiny：BigGAN、ADM、GLIDE、VQDM、SD-v1.5、Wukong、Midjourney 各 1 张。

每类少量取样，不以数量充当覆盖率。这些是开发联调材料，不是正式评测集。CASIA 类型依据 Tp_D/Tp_S 命名和本地清单的 source_ids。IMD2020 仅使用了本机已有的 Yu2018 修复子集，不代表完整 IMD2020。不同生成器来源不代表互斥的真实性类别。

目录如下：

```text
stage1-materials/
  MATERIALS.md                 覆盖范围和限制
  manifest.tsv                 全部样本的来源、类别、哈希及标注引用
  vlm-input.example.json       唯一一份给第四人的 JSON
  sample-001/
    images/original.jpg        原文件的字节副本
    images/display.png         校正 EXIF 方向后的未缩放显示副本
  ...
  sample-005/
    images/original.jpg
    images/display.png
    annotations/               原生真值掩码，不进入 VLM
    artifacts/                 此 JSON 使用的模拟掩码、热图和实际裁剪
  ...
```

材料目录中只有一份 JSON。`schemas/` 中的 JSON 是协议定义，不是额外的示例报告。

## 唯一 JSON 怎么用

`vlm-input.example.json` 针对 `sample-005`（IMD2020 修复图片）。它只汇总来源分析、篡改检测和 AI 检测三个模块，留给第四个人生成自己的输出，不包含预置的自然语言答案。

- 图片哈希、尺寸和显示副本变换来自实际读取。
- 所有分析报告的 `mode` 均为 `mock`；没有调用任何检测模型或 VLM。
- 来源凭证、水印和完整元数据取证是 `not_run`，不是“未发现”。
- 分类标签和分数为预设演示值。演示矩形按图片尺寸的固定比例生成，不使用数据集真值构造预测。
- 原图、显示副本、裁剪、模拟掩码和热图都通过附件 ID 引用；路径相对于材料包根目录。

第四个人读取 JSON 后，按附件类型选择并实际加载图片传给 VLM。不要把 `manifest.tsv`、`annotations/` 或真实数据标签作为待测图像的推理证据。

第二个人可以使用材料的三类篡改图和原生标注做接入与可视化。第三个人可以使用不同生成器的图片和真实对照做接入。第一人使用原始文件进行来源信息分析，不能从已重新编码的显示图读取原始凭证。

原生标注原样保存，坐标属于 `encoded_file_pixels`。IMD2020 掩码为 JPEG，有灰度压缩值；使用时参考现有 128 阈值约定，不能直接当作严格 0/255 二值预测。需要对比模型输出时先统一坐标与阈值。

完整协议见 `docs/REPORT_PROTOCOL_V1.md`。当前 APP 仍使用旧报告接口，尚未支持直接导入此 JSON；这份材料用于模块联调和后续接入。

## 准备自己的材料

按根目录 README 配置 Node 24 LTS 并安装项目依赖，然后执行：

```powershell
Copy-Item examples/sample-selection.example.json examples/local-selection.json
```

修改本地选择清单：

- `exampleCaseId` 指定唯一 VLM 示例使用哪张图片。
- `cases` 按类型各选一张，`caseId` 使用 `sample-001` 等中性名称。
- 填入 `sourceImage`、可选 `sourceMask`、数据集和来源信息。
- `kind` 为 `real`、`tampered` 或 `ai_generated`；具体类别和依据写入 `category`、`typeBasis`。
- 可以补充 `generator`、`pairId` 记录生成器或原图/编辑图配对关系。
- 模板中的 `C:/datasets/example/...` 和 `example.org` 是待替换内容。相对源路径以选择清单所在目录为准。

运行：

```powershell
npm.cmd run examples:prepare
npm.cmd run examples:validate
```

默认生成 `examples/stage1-materials/`。生成器的中间报告位于 `work/`，不会进入正式材料包。重复执行会更新相应的生成文件和报告 ID；新增输出类型或更换示例时，建议指定新的输出目录，避免把旧附件带入新包。

也可以指定输出与校验目录：

```powershell
npm.cmd run examples:prepare -- --output work/my-materials
npm.cmd run examples:validate -- --input work/my-materials
```

如果已收到完整材料包，将其中的 `examples/stage1-materials/` 放到项目同名位置后即可校验，不需要持有源数据集。校验单个 VLM 包可使用：

```powershell
npm.cmd run examples:validate -- --bundle examples/stage1-materials/vlm-input.example.json
```

这些脚本不需要 Python、GPU、模型权重或 API Key，不修改原始数据集，也不运行 APP 或模型测试。

## 发布和未覆盖项

协议、Schema、脚本和选择模板可随项目共享。实际图片、原生标注和本机选择清单均被 Git 忽略，不自动推送公共仓库。图片的使用条件仍以原数据集为准，代码许可证不自动覆盖数据集。

当前没有已验证的来源凭证阳性、水印阳性和多步编辑过程标注样例。七个生成器与三类篡改是当前选取范围，不表示对全部生成或编辑方式的覆盖。
