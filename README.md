<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/sofunai-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="assets/brand/sofunai-logo-light.svg">
  <img src="assets/brand/sofunai-logo-light.svg" alt="SofunAI Studio" width="240">
</picture>

**Published and maintained by [SofunAI Studio](assets/brand/README.md).**

**[GitHub repository](https://github.com/KyleZheng8848/cpet)** · [Report an issue](https://github.com/KyleZheng8848/cpet/issues)

**[English](README.md)** | [简体中文](README.zh-CN.md)

# CPET

A desktop pet that reflects your coding agent's activity and opens a workspace for real conversations and tasks. CPET connects to locally installed Cursor, OpenClaw, Claude Code, Codex and OpenCode, or an OpenAI / Anthropic compatible API you configure.

The application shell and unit tests work without model credentials. Real tasks require an installed, authenticated agent or your own API endpoint and key. Provider access, usage limits and billing remain with the service you choose.

## Download the macOS app

[All releases](https://github.com/KyleZheng8848/cpet/releases) · **0.4.53**

- [Apple Silicon (M-series) — DMG](https://github.com/KyleZheng8848/cpet/releases/download/v0.4.53/CPET-0.4.53-arm64.dmg)
- [Intel — DMG](https://github.com/KyleZheng8848/cpet/releases/download/v0.4.53/CPET-0.4.53-x64.dmg)

ZIP alternatives and `SHA256SUMS.txt` are available on the release page. The apps use ad hoc signing and are not notarized by Apple. Open the DMG and run `安装并打开.command` to install and launch.

## Features

- A draggable, transparent desktop pet with thinking, tool, reply, done, error and waiting states.
- Streaming conversations, attachments, collapsible reasoning/tool output, task prompts, skills and model comparisons.
- Q&A, Plan and Agent task modes mapped to supported engine capabilities; choose a project directory before giving an agent write access.
- IDE hook integration for activity and completion notifications, separate from running a CLI inside CPET.
- Built-in vector appearances, two ready-to-use image skins, theme controls and user avatars.
- Scheduled tasks, RSS reading/digests, reminders and optional weather and speech features.
- English and Simplified Chinese interfaces; settings and conversation history stored locally.

## Build and run

Use **Node.js 22 LTS** (22.14 or newer) and npm. macOS is the primary desktop development target. Packaging definitions also exist for Windows and Linux; verify each target before distributing it.

```bash
git clone https://github.com/KyleZheng8848/cpet.git
cd cpet
npm ci
npm run dev
```

`npm ci` downloads Electron and generates icons locally. To run source checks without opening the desktop application:

```bash
npm ci
npm run verify
npm run build
```

Some tests import Electron’s package entry, so its installation must complete even though the tests do not launch GUI windows. A desktop run requires a graphical session. Optional macOS dictation additionally needs Xcode Command Line Tools / Swift and `npm run build:dictation`; the rest of the application works without it.

## Two ways to use it

**Follow activity in your IDE:** enable the supported IDE integration in CPET and run an agent in that IDE. Using Cursor this way requires the Cursor application, not the separate `cursor-agent` CLI. Enabling integration may update the corresponding local hook configuration.

**Run tasks in CPET:** install and authenticate a supported agent CLI, or configure a custom API. Pick a project directory and an appropriate task mode. The engine badge identifies the real backend; Demo mode is not a working external agent. Real tasks can edit files and run commands according to the selected mode and backend's permissions.

Use **Settings → Engine setup** to see installed engines and setup instructions. Cursor CLI has an installation/login helper; other agents provide commands and official documentation. A custom API needs a base URL and key and works without agent CLIs.

## Language and About

CPET follows the system language by default, falling back to English for unsupported languages. Change **Settings → Interface language** to switch all windows. Conversation text, model replies, model IDs and custom task names retain their original content. Historical changelog entries remain in Chinese.

**Settings → About CPET** displays the product version, independent SofunAI Studio mark, copyright, a clickable GitHub source link and issue feedback. The application menu also has **CPET → About CPET**. The studio identity is separate from CPET's product logo and pet appearance.

## Included artwork and skills

This public source snapshot includes the two image skins configured for application packaging: **赛博幽灵** (Cyber Ghost) and **数字佳人** (Digital Belle), plus the built-in vector appearances. Extra market packs, raw generation references, `_work`, `_frames` and private generation runs are not part of this snapshot. They remain in the original development directory; no original artwork was deleted.

The bundled skills in `.cursor/skills/` cover skin creation, RSS digest writing and iterative prompt/workflow improvement. Skin tools accept local artwork supplied through authorized generation tools. Creating new images, optional Python cutout dependencies and external model downloads are separate from building CPET. Preserve the rights and licenses for any artwork or models you add.

No default skin market or binary download bucket is configured in this source. The app shows an explicit unconfigured state for optional distribution services until a maintainer provides them. GitHub repository metadata identifies the source and lets the update checker discover the published GitHub Releases.

## Data and permissions

Settings and conversations are kept in Electron's local `userData` directory, not the repository or installation package. On macOS this is normally `~/Library/Application Support/cursor-pet`. API keys configured inside CPET are stored with local settings; protect that directory and do not publish diagnostic output, conversations or credentials without reviewing them.

Selected agents and API providers receive the task content and attachments they need. IDE integrations read local agent events/transcripts. RSS/weather services, optional Edge TTS or a configured local CosyVoice sidecar, and update checks have their own network behavior. Default operation does not require OSS publishing credentials or access to a maintainer's accounts.

## Development and distribution

```bash
npm run typecheck
npm run lint
npm test
npm run check:version
npm run build
```

`npm run verify` combines the first four checks. Unit tests exercise pure logic and temporary data; they do not start real agent CLIs or charge model accounts. Live `smoke:agents` commands are optional and can invoke your installed agents and consume quota.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [development notes](docs/DEVELOPMENT.md) and the [release guide](docs/RELEASING.md) before contributing or packaging. Publishing to a storage bucket requires your own configuration and credentials; [.env.example](.env.example) is an optional maintainer template. Building or testing source does not publish or install an application.

## License

Originally developed by KyleZheng8848; published and maintained by SofunAI Studio. Source and included project assets are available under the [MIT License](LICENSE), with the original [studio asset license](assets/brand/LICENSE) retained. Dependencies, optional model weights and user-supplied artwork retain their respective licenses. See [LEGAL.md](LEGAL.md) for the original comment-language notice and [CHANGELOG.md](CHANGELOG.md) for change history.
