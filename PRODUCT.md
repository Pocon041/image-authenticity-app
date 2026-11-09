# 通用鉴伪系统

<!-- impeccable:product-schema 1 -->

## Platform

web

界面由 React 渲染，运行于 Windows Electron 桌面应用。产品交互采用桌面工作台，支持本地文件选择、独立设置与键盘操作。

## Users

普通用户通过选图和开始分析完成检查。开发者与研究人员按需查看模型状态、定位掩码、结构化证据和原始报告。

## Product Purpose

检查图像的来源信息、AI 生成线索和局部篡改线索，将定位结果与解释组织为可查看的分析结果。

## Capabilities and Constraints

- 来源检查、FSD、SICA、RITA、RiSE 和解释链路已经接入。
- 每次处理一张本地图片。原图与各模型结果分别查看。
- 文件选择、拖拽和剪贴板导入使用同一套格式、大小、解码与会话互斥检查。
- 分数、掩码、失败状态与报告引用沿用既有协议。
- 本轮仅本地 UI 开发，保留当前未提交改动与有效分析结果。

## Brand Commitments

应用可见名称为“通用鉴伪系统”。用户明确要求具有 Apple、Google 产品的克制与专业质感，适合新手和专业用户使用。首页省略装饰性文案，配置与高级工具适当收纳。

## Evidence on Hand

界面实现位于 src/renderer/src，桌面入口位于 src/main/index.ts。work/smoke 与 work/conversation-smoke 中的截图和回归记录可用于比较。现有报告与用户图片留在本地。

## Product Principles

- 以图片与分析结果为中心。
- 自然语言解释帮助用户理解证据，并通过原图/定位视图回到图像核查。
- 操作名称直接清楚，状态与恢复入口可见。
- 专业信息按需查看。
- 视觉层级支持判断与比较。
