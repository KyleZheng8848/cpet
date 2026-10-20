<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/sofunai-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/sofunai-logo-light.svg">
  <img src="assets/brand/sofunai-logo-light.svg" alt="SofunAI Studio" width="240">
</picture>

**由 [SofunAI 工作室](assets/brand/README.md)出品并维护。**

**[GitHub 仓库](https://github.com/KyleZheng8848/cpet)** · **[Releases](https://github.com/KyleZheng8848/cpet/releases)** · **[下载最新版](https://github.com/KyleZheng8848/cpet/releases/latest)** · [问题反馈](https://github.com/KyleZheng8848/cpet/issues)

[English](README.md) | **[简体中文](README.zh-CN.md)**

# CPET

一只反映编程 Agent 工作状态的桌面宠物，也能打开工作台派发真实任务。支持本机的 Cursor、OpenClaw、Claude Code、Codex、OpenCode，或自行配置 OpenAI / Anthropic 兼容 API。

应用界面和单元测试不需要模型凭据。真实任务需要已安装并登录的 Agent，或自己的 API 地址与 Key；服务资格、额度及费用由所选供应商决定。

## Releases · 下载 macOS 应用

[Releases](https://github.com/KyleZheng8848/cpet/releases) · **[0.4.53](https://github.com/KyleZheng8848/cpet/releases/tag/v0.4.53)**

- [Apple Silicon（M 系列芯片）— DMG](https://github.com/KyleZheng8848/cpet/releases/download/v0.4.53/CPET-0.4.53-arm64.dmg)
- [Intel 芯片 — DMG](https://github.com/KyleZheng8848/cpet/releases/download/v0.4.53/CPET-0.4.53-x64.dmg)

Release 页面同时提供 ZIP 和 `SHA256SUMS.txt` 校验文件。应用采用临时签名，尚未经过 Apple 公证。打开 DMG 后，运行其中的「安装并打开.command」完成安装与启动。

## 功能

- 透明、可拖动的桌宠，展示思考、工具、回复、完成、出错、等待等状态。
- 流式对话、附件、可折叠思考/工具过程、任务提示词、技能和多模型对比。
- 问答、计划、代理三种任务模式，映射到各引擎支持的权限；允许写文件前先选择项目目录。
- IDE hook 联动与完成通知，可独立于 CPET 内运行 CLI 使用。
- 内置矢量形象、两款可直接使用的图片皮肤、对话配色和用户头像。
- 定时任务、RSS 阅读/简报、提醒，以及可选天气、语音功能。
- 简体中文与英语界面，设置和对话历史存放在本机。

## 构建运行

使用 **Node.js 22 LTS**（22.14 或更高）及 npm。主要桌面开发环境为 macOS；仓库也有 Windows/Linux 打包定义，分发前需在对应平台验证。

```bash
git clone https://github.com/KyleZheng8848/cpet.git
cd cpet
npm ci
npm run dev
```

`npm ci` 会下载 Electron 并在本地生成图标。只检查源码、不启动桌面窗口时：

```bash
npm ci
npm run verify
npm run build
```

部分测试会导入 Electron 包入口，因此需要完成 Electron 安装，但测试不会启动图形窗口。实际桌面运行需使用图形环境。可选的 macOS 听写还需要 Xcode Command Line Tools / Swift 与 `npm run build:dictation`；不编译听写桥接也可使用应用其他部分。

## 两种用法

**跟随 IDE 工作状态：** 在 CPET 开启支持的 IDE 联动，再到 IDE 内运行 Agent。Cursor 这条路径需要 Cursor 应用，不需要单独的 `cursor-agent` CLI；开启联动可能更新对应本地 hook 配置。

**在 CPET 中直接派活：** 安装并登录支持的 Agent CLI，或配置自己的 API；选择项目目录和适当任务模式。引擎徽章显示真实后端，“演示”不表示已接通外部 Agent。真实任务会按所选模式与后端权限编辑文件、执行命令。

在 **设置 → 引擎安装助手** 查看检测结果及配置方式。Cursor CLI 提供安装/登录辅助，其他 Agent 提供命令和官方文档；自定义 API 填地址与 Key 即可，无需安装 Agent CLI。

## 语言与关于页

默认跟随系统语言，未支持的语言回退为英语。通过 **设置 → 界面语言** 切换，所有窗口同步；聊天正文、模型回复、模型 ID 和自定义任务名保留原文。历史更新说明保留中文。

**设置 → 关于 CPET** 展示产品版本、独立 SofunAI 标识、版权、可点击的 GitHub 源码入口和问题反馈。应用菜单也提供 **CPET → 关于 CPET**。工作室标识独立于 CPET 产品 logo 和宠物形象。

## 随附素材与技能

公开源码快照包含当前安装包配置的两款图片皮肤：**赛博幽灵、数字佳人**，以及内置矢量形象。其他市场皮肤、原始生成参考、`_work`、`_frames` 和私人生成记录不包含在这次快照中；这些内容继续保留在原开发目录，没有删除原始素材。

`.cursor/skills/` 随附皮肤制作、RSS 简报和提示词/工作流迭代技能。皮肤工具使用通过已授权工具制作或自行提供的本地图片。生成新素材、安装可选 Python 抠图依赖及下载模型均独立于 CPET 构建；自行添加素材与模型时保留相应权利和许可。

源码未配置默认皮肤市场或二进制下载桶，相关可选服务会明确提示未配置。GitHub 仓库元数据标明源码归属，更新检查器可查询已发布的 GitHub Release。

## 数据与权限

设置、对话存放在 Electron 的本地 `userData`，不会随仓库或安装包分发。macOS 通常位于 `~/Library/Application Support/cursor-pet`。应用中配置的 API Key 随本地设置保存，请保护该目录，分享诊断、聊天或配置前先检查凭据与私人内容。

所选 Agent/API 供应商会接收任务所需的内容和附件；IDE 联动读取本机的事件/记录。RSS、天气、可选 Edge TTS 或本机 CosyVoice 侧车，以及更新检查各有相应网络行为。默认使用不需要 OSS 发布密钥或维护者账户权限。

## 开发与分发

```bash
npm run typecheck
npm run lint
npm test
npm run check:version
npm run build
```

`npm run verify` 合并前四项检查。单元测试使用纯逻辑与临时数据，不启动真实 Agent CLI、不产生模型调用费用；可选 `smoke:agents` 会调用本机已安装的 Agent，可能消耗额度。

参与开发、打包前阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[开发说明](docs/DEVELOPMENT.md)和[发布文档](docs/RELEASING.md)。存储桶发布使用自己的配置与密钥，[.env.example](.env.example) 仅为维护者可选模板；构建和测试不执行发布或安装。

## 许可证

最初由 KyleZheng8848 开发，现由 SofunAI 工作室出品并维护。源码与随附项目素材采用 [MIT License](LICENSE)，保留原[工作室素材许可](assets/brand/LICENSE)。第三方依赖、可选模型权重及用户提供的素材遵循各自许可。[LEGAL.md](LEGAL.md) 保留原有注释语言声明，历史变更见 [CHANGELOG.md](CHANGELOG.md)。
