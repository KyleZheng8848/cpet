# 开发 / Development

CPET is published by SofunAI Studio: [GitHub](https://github.com/KyleZheng8848/cpet).

## 工具链与运行

Node.js 22 LTS（最低 22.14）与 npm。Electron + electron-vite + React + TypeScript。

```bash
npm ci
npm run dev
```

安装时自动生成图标。跳过了 postinstall 时执行 `node node_modules/electron/install.js` 与 `npm run icons`。macOS 可选听写需要 Swift / Xcode Command Line Tools，执行 `npm run build:dictation`。没有听写桥接也能启动其他功能。

## 检查

```bash
npm ci
npm run verify
npm run build
```

`verify` 依次运行主进程/渲染进程/测试的类型检查、ESLint、Vitest 和版本一致性检查。CI 使用相同门禁并构建生产 bundle。单元测试不启动真实 CLI，不用私人数据与真实密钥。warning 上限只可降低，不以放宽门禁替代修复。

`smoke:agents:quick` / `smoke:agents` 为可选真实集成检查，会调用本机 CLI 并可能产生费用。`scripts/smoke-app.mjs` 为维护者的隔离 Electron 应用验收工具，使用临时 HOME/userData 与本地模拟接口；执行前检查其当前行为与所需环境。

## 目录

- `src/main/`：Agent runner、hook、窗口、存储与更新检查。
- `src/preload/`：受控 IPC 接口。
- `src/renderer/`：宠物、聊天、皮肤窗口。
- `src/shared/`：公共类型、权限、任务、皮肤和语言逻辑。
- `tests/`：Vitest 逻辑测试。
- `assets/skins/`：随附两款成品皮肤与动作目录。
- `.cursor/skills/`：随附技能与本地素材处理工具。
- `resources/cosyvoice/`：可选侧车源码，不含模型权重。

本公开快照不含原开发目录的其他市场皮肤、原始生成素材及中间帧，保留原开发资料与开源快照各自用途。不要将 userData、账号配置或模型权重复制进源码。

## IDE 联动

用户开启联动后，`src/main/setup.ts` 管理本机 hook 配置，`hookServer.ts` 与 `hookInbox.ts` 接收生命周期事件并由主进程派发。HTTP 与文件收件箱可并用；收件箱有文件监听和轮询兜底。修改这些入口时使用临时目录与模拟事件，避免测试修改开发者正在使用的 IDE 配置。

## 皮肤和语言

皮肤制作入口为 `.cursor/skills/cpet-cute-skins/`，动作与生命周期目录也随附在 `assets/skins/`。图像生成由已授权工具或用户提供，不依赖某台开发机的内部服务。保留素材与模型许可。

英文词典在 `src/shared/locales/en.json`，中文原文为键。新增界面文案时补齐英文；模型 ID、路径与用户内容不参与翻译。新关于组件在 `StudioPublisher.tsx`，保留独立 studio logo 和可点击 GitHub 链接。
