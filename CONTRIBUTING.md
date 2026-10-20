# Contributing / 参与贡献

[CPET on GitHub](https://github.com/KyleZheng8848/cpet) is maintained by SofunAI Studio. Use Node.js 22 LTS (minimum 22.14).

CPET 由 SofunAI 工作室维护，使用 Node.js 22 LTS（最低 22.14）。

```bash
npm ci
npm run verify
npm run build
```

Unit tests use mocks and temporary data. They do not invoke real agent CLIs. Live `smoke:agents` commands may edit their test workspace and consume provider quota; run them only for a deliberate integration check. The desktop requires Electron's install script and generated icons; see [DEVELOPMENT.md](docs/DEVELOPMENT.md).

单元测试使用模拟和临时数据，不调用真实 Agent。`smoke:agents` 为可选集成测试，可能修改测试工作区并消耗供应商额度。桌面运行需安装 Electron 并生成图标，详见开发说明。

Keep both README languages and the English UI catalog in sync. Preserve the SofunAI mark and the visible project GitHub link. For versioned product changes, synchronize `package.json`, `CHANGELOG.md` and `src/shared/changelog.ts`; do not increase the ESLint warning allowance to hide regressions.

同步维护两种 README 及英文词典，保留 SofunAI 标识与醒目的 GitHub 链接。产品升版时同步上述三处版本；不要提高 ESLint warning 上限掩盖回归。

Issues and PRs should include platform, version, reproduction steps and relevant check results. Remove API keys, private conversations, account details, local paths and identifying logs. Never commit userData, `.env.local`, credentials, raw skin references, `_work`, `_frames`, model weights, build output or installation packages.

问题和 PR 请说明平台、版本、复现步骤和检查结果。删除 API Key、私人聊天、账号信息、本机路径和个人日志；不要提交上述本地数据与生成产物。

Retain MIT and third-party notices. Source contributions need no OSS credentials. Packaging, bucket publication, skin-market updates and local installation are distinct maintainer operations; see [RELEASING.md](docs/RELEASING.md).

保留 MIT 与第三方声明，源码贡献不需要 OSS 权限。打包、上传、皮肤市场更新和本机安装分别处理，详见发布说明。
