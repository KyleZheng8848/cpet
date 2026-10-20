# 打包与发版

面向要出包、发版、换分发源的人。日常开发看 [DEVELOPMENT.md](DEVELOPMENT.md)。

Agent 说「更新」时用项目 Skill [`.cursor/skills/cpet-update`](../.cursor/skills/cpet-update/SKILL.md)（完成标准：源码 / 安装包 / 发布页 / 皮肤同环，`npm run verify:surface` / `update:check`）。打包前核对本页流程与当前脚本。
## 皮肤市场（OSS）

皮肤与安装包同桶、不同前缀，互不覆盖。**发版时与安装包同环发布**（源码 / 包 / 下载页 / 皮肤四条对齐）：

```
…/CPET/skins/catalog.json
…/CPET/skins/packs/<id>.zip
…/CPET/skins/previews/<id>.gif
```

应用只匿名读 `cpet.skinCatalog`（缺省则拼 `downloadBaseUrl + skins/catalog.json`）。上传密钥仍在 `.env.local`，不要写进安装包。

```bash
npm run skins:publish            # 上传 assets/skins 全部交付包 + 覆盖目录
npm run skins:publish -- --dry-run
npm run skins:publish -- 云朵羊   # 只发指定包（仍会重写整份 catalog）
npm run verify:surface           # 源码版本 ↔ latest.json ↔ 下载页 ↔ 皮肤 catalog
```

注意：`skins:publish` 每次都会按当前本地包列表重写 `catalog.json`。只发一个包时，目录里其它条目仍来自本地扫描——不是「远端合并」。远端有、本地没有的皮肤，会被这次发布冲掉。交付皮肤必须先入库，禁止「市场有、仓库没有」。

## 打包

```bash
npm run package:mac      # Apple Silicon arm64
npm run package:mac:all  # arm64 + Intel x64
npm run package:win      # Windows x64（NSIS .exe；mac 上不需要 wine）
npm run package:linux    # 宿主机架构的 AppImage；要 x64 用：npx electron-builder --linux --x64
```

四端齐出时在本机依次跑 `package:mac:all`、`package:win`、以及 arm64 + x64 的 linux。GitHub 拉 Electron 慢就设 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。Linux x64 产物文件名是 `x86_64.AppImage`（electron-builder 的惯例），不是 `x64`。

产物落在 `release/`，形如 `CPET-<版本>-arm64.dmg`。

每个 `package:*` 都会先过 `check:version`，打完再跑 `npm run verify:release`。后者是硬门禁，两条红线：包里不许夹带本机对话 / 设置（那些只应该待在 userData，否则你把聊天记录发给了下载的人），皮肤中间产物 `_work`、`_frames` 不许进包（400MB+）。`electron-builder.yml` 里的 filter 写错时没人会发现，只会看到 DMG 莫名其妙大了几百兆，所以这里直接让打包失败。

打包结束会自动跑一次 `npm run release:prune`，本地**只保留最近 20 个版本**（数量在 `package.json` 的 `cpet.keepReleases`，当前版本强制保留）。这条不是洁癖：一版 dmg + zip 约 340MB，打包只加不删，不清理的话每按一次打包就多 340MB，攒几十版就是几十 GB 躺在磁盘上。想先看会删什么：

```bash
npm run release:prune -- --dry-run
```

## 发一版

1. 改 `package.json` 的 `version`
2. `CHANGELOG.md` 加一条 `## <版本> — <日期>`
3. `src/shared/changelog.ts` 加同一条（应用内「关于」读的是它，不是 markdown）
4. `npm run verify` —— `package.json` / `CHANGELOG.md` / `changelog.ts` 三处对不上会直接失败
5. `npm run package:mac`
6. `npm run release:publish`（上传后会跑 `verify:published`：HTTP/体积、macOS DMG 必须含「安装并打开.command」、模拟隔离后安装启动；**预检不过不会切换 latest.json**）
7. 提交 README（发布脚本会重写它的下载区）

macOS 用户应从 DMG 里双击 **「安装并打开.command」**，不要直接点 `CPET.app`（浏览器 quarantine 会误报「已损坏」）。

第 4 步会顺带提醒「`release/latest.json` 还停在上一版」。**那是警告不是错误**，此时清单本来就该落后——它在第 6 步才会被重新生成。反过来，清单版本比 `package.json` 还新会直接失败：那说明有人把版本号改回去了，用户会被指向一个仓库里不存在的版本。

想先看会发生什么：`npm run release:publish -- --dry-run`。只想生成清单不上传：`npm run manifest`。

换了台机器、或者远端历史版本断档时，加 `--backfill`：

```bash
npm run release:publish -- --backfill
```

它会把 `release/` 里还留着的历史版本一并传上去（超出保留数的不传，传了下一步也会被删）。按文件名 + 大小比对，传过的跳过，所以中途断了重跑同一条命令就是续传。上传本身带重试，单个包一分多钟，网络抖一下不至于让 2GB 白传。

## release:publish 做了什么

顺序是固定的，每一步都有它必须在那个位置的理由：

1. **传本版安装包**
2. **复制出固定名** `CPET-latest-arm64.dmg`（服务端复制，174MB 不重传一遍）。README 和下载页链的都是固定名，发新版不用改任何文档，也不会留下死链
3. **生成并覆盖 `latest.json`**
4. **渲染下载页 `index.html` 和 README 的下载区**，数据来自清单 + 远端列表 + `CHANGELOG.md`
5. **删掉超出保留数的远端旧版本**

第 1 步必须在第 3 步之前。反过来的话，中间那几分钟里点「检查更新」的人会拿到一个下载 404 的版本。

第 4 步不手写。手写的下载页迟早会出现「页面写着新版、按钮下下来是旧版」；README 里的下载表同理，所以它被夹在 `<!-- CPET:DOWNLOADS:START -->` / `<!-- CPET:DOWNLOADS:END -->` 之间，整块由脚本重写，标记以外的正文不动。README 的表按**远端真实存在的包**生成，不是按 `package.json` 的版本号——版本号只代表你打算发什么，用户能不能下到是另一回事。

发布之外想单独重建 README 下载区：

```bash
npm run docs:downloads            # 重写
npm run docs:downloads -- --check # 只比对，不一致退出码 1
```

`--check` 没有进 `npm run verify`，这是故意的：刚 bump 完版本、包还没发出去的时候，README 本来就该落后于 `package.json`，把它加进门禁只会让每次改版本号都必挂。

发布目前在本机跑，README 由你自己提交（第 7 步）。哪天挪进 CI 要先决定这件事：要么让 CI 把改动回推到 master，要么就别在 CI 里改 README、只更新 OSS 上的下载页——不做决定的话，仓库里的表会停在最后一次人工发布的那一版。

上传不依赖 `ossutil`。`scripts/lib/oss.mjs` 只用 node 内置模块做 OSS 签名，`npm i` 完就能发，CI 里也不用额外装 CLI。对象一律以 `public-read` 上传——更新检查是匿名 `fetch`，传成私有的等于用户点「检查更新」永远 403。

## 皮肤市场目录

图片皮肤包走同一 bucket 的 `CPET/skins/` 前缀（与安装包并列，不混进版本目录）：

```text
CPET/skins/catalog.json
CPET/skins/packs/<id>.zip
CPET/skins/previews/<id>.gif
```

```bash
npm run skins:publish            # 打包 assets/skins 成品 → 上传 zip + catalog.json
npm run skins:publish -- --dry-run
npm run skins:publish -- 云朵羊   # 只发指定包
```

应用读 `cpet.skinCatalog`（默认 `${downloadBaseUrl}skins/catalog.json`）。缺密钥时脚本 fail-closed；目录拉不到时应用仍可管理本机已安装皮肤。密钥只放 `.env.local`，不要写进仓库。

密钥走 `.env.local`（已 gitignore，**不要写进 `package.json`**）：

```bash
OSS_ACCESS_KEY_ID=...
OSS_ACCESS_KEY_SECRET=...
```

## 分发源配置

默认未配置分发源，更新检查和皮肤市场会显示「未配置」。如需发布，按实际托管服务填写 `package.json` 的 `cpet` 段；下面仅为示例，**不包含密钥**：

```json
"cpet": {
  "keepReleases": 20,
  "ossTarget": "oss://your-bucket/CPET/",
  "ossEndpoint": "oss-cn-hangzhou.aliyuncs.com",
  "updateManifest": "https://downloads.example.com/CPET/latest.json",
  "downloadBaseUrl": "https://downloads.example.com/CPET/",
  "downloadPage": "https://downloads.example.com/CPET/index.html",
  "repoUrl": "https://github.com/your-org/your-repo"
}
```

各字段谁在读：`updateManifest` 是应用查更新的入口；`downloadBaseUrl` 拼出清单里的下载地址，也是 README 下载表的前缀；`downloadPage` 写进 `latest.json`，挑不到对应平台安装包时兜底跳这里；`repoUrl` 只显示在下载页页脚；`keepReleases` 本地和远端共用。

`updateManifest` / `downloadBaseUrl` 指向的地址必须**匿名可访问**：应用用不带凭证的 `fetch` 去拉，需要登录态的地址（比如 代码托管平台 的 raw 链接）会让「检查更新」永远停在失败态。`ossTarget` / `ossEndpoint` 只给发布脚本上传用，不会进安装包。

CI 里可用环境变量覆盖，不必把主机地址写进仓库：`CPET_OSS_TARGET`、`CPET_OSS_ENDPOINT`、`CPET_DOWNLOAD_BASE_URL`、`CPET_DOWNLOAD_PAGE`。

`npm run check:version` 也看 `release/latest.json`，规则见上面第 4 步：落后只警告，超前才失败。

除自托管清单外，也支持公开 GitHub 仓库：填 `"repository": "owner/repo"`，自动查 Releases API。`CPET_UPDATE_MANIFEST_URL` / `CPET_RELEASES_URL` 可覆盖。两者都没配时，「检查更新」按钮会明说「未配置发布源」，而不是假装已是最新。

## 更新检查的行为

- **后台**：启动 20 秒后静默查一次，之后每 24 小时一次（CPET 关窗不退出，可能连着开好几天）。只在真有新版时发系统通知，**同一个版本只弹一次**（记在 `settings.updateNoticeSeenVersion`）。离线、没配发布源、接口出错，一律静默。有新版时托盘菜单顶部会多一条「↑ 有新版本 x.y.z」。
- **手动**：设置 → 关于 → 检查更新。

两者都按当前平台/架构挑对应安装包，挑不到就只给下载页，绝不会把 arm64 的包推给 Intel 机器。

目前只做到「发现新版 → 打开下载页」，不做静默自动安装：mac 包未签名（`identity: null`），electron-updater 在未签名应用上无法完成替换。等有 Developer ID 证书再换。
