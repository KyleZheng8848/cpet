# 运维参考（帧 / 成本 / 校验 / 贴边 / 视觉自检）

本页命令用 `$CPET` 指代 skill 目录（`export CPET="$HOME/.cursor/skills/cpet-cute-skins"`），
`<out>` 指 `cpet paths` 报出的产出目录（默认 `<项目>/cpet-skins`）。

本地目录表见 Skill 内建；图片由已授权工具或用户提供：

- [catalogs/LIFECYCLE.json](catalogs/LIFECYCLE.json)
- [catalogs/ACTION_CATALOG.json](catalogs/ACTION_CATALOG.json)

## skin.json 字段

| 字段 | 说明 |
|------|------|
| `id` | kebab-case 工作目录名 |
| `packName` | 中文产品包文件夹名 |
| `characterPrompt` | 英文身份锁（物种/色/标志物/线色/**肢数**/禁漂浮装饰） |
| `identityRef` | 通常 `raw/idle.png` |
| `model` | 生图模型 ID |

示例：[examples/skin.json.example](examples/skin.json.example)

### brief 必写 / 禁写

**必写：** 物种与主色；线色；**明确肢数**（`EXACTLY four tiny limbs` 或 `NO legs visible — cloud blob`）；`opaque solid #FFFFFF canvas`；`SINGLE character`。

**禁写（会教坏模型）：** `floating cloud puffs` / `accent stickers around` / `transparency` / `checkerboard` / 未限定的 `sticker props`。
需要氛围时写进**身体本身**（「身体就是云朵毛」），不要写「周围漂浮小云」。

动作需要手时：`at most TWO tiny front hoof-hands when pose requires; NEVER large foot soles / paw pads / belly feet rows / 5–6 limbs`。

---

## 目录字段：`pose` + `animBeat`(+`animBeats`)

每个 lifecycle / action stem **必须**有：

| 字段 | 用途 |
|------|------|
| `pose` | 生成 `raw` / `anim/00` 的主姿势 |
| `animBeat` | 生成 `anim/01` 的主对立运动拍（肢体/身体/道具） |
| `animBeats` | 可选 `string[]`，供 `FRAMES≥4` 时填 `02..` 的额外姿势拍（缺少的运动拍需另行制图） |
| `eyesClosed` | 闭眼态；最后一帧用闭眼副拍而非眨眼 |

`animBeat` 示例（对）：`wave paw on the opposite swing (up↔down), eyes stay open`
`animBeat` 反例（错）：`eyes closed blink`、`same pose slight smile`

改 catalog 时：**skill `catalogs/` 与产出目录里那份（若存在，如 cursor-pet 的 `assets/skins/`）一起改**。

---

## 帧与成本 / 提效 {#帧与成本提效}

### FRAMES=3～8（交付区间）

| 帧 | 路径 | 必须表达 |
|----|------|----------|
| `00` | `anim/<stem>/00.png`（= raw） | `pose` |
| `01` … `N-2` | `anim/01` … | **姿势/道具**（`animBeat` / `animBeats` / 程序补相），禁止只眨眼 |
| `N-1` | 最后一帧 | 眨眼或闭眼副拍 |

- 默认 **`FRAMES=4`**；提交图片应保持 3～8 帧。
- 齐套：每个 stem 有 `raw` + `00` .. `(FRAMES-1)`。缺最后一帧 = 未交付。

### API 次数

| FRAMES | 一套（30 stem） |
|--------|----------------|
| 3 | 90 |
| 4（默认） | 120 |
| 6 | 180 |
| 8 | 240 |

另加 idle 候选 ≥3；返试另计。本地管线 0 次模型。

### 允许的提效

1. 锁好 idle 后，对其余 stem **并行 2～3 路**（按 stem 分片）。
2. 可选 **4～6 格 pose bible**（设计用，不进包）。
3. 补帧：删 `anim/**` 下非 `00` 的 png，按目标 `FRAMES` 提供新图片，保留 raw。
4. 观感不够再把 `FRAMES` 从 4 提到 6～8（成本线性）。

### 禁止的「假提效」

| 做法 | 为什么禁 |
|------|----------|
| 一张 30 格拼图裁成 raw | 单格分辨率崩；一格坏毁一片；难单 stem 返工 |
| `FRAMES<3` | 动作只剩眨眼或更糟 |
| `FRAMES>8` | 边际收益低、漂移与费用暴涨 |
| 小格裁切直接当 Edit ref | 身份锁变糊 |

墙表格若要用：只能 **裁切 → 以满幅 idle 为 ref 再 Edit 升到 1024**。

---

## 缺陷分类（交付前必须过）

| 代码 | 症状 | 谁查 | 根因类 |
|------|------|------|--------|
| `LIMB_EXTRA` | 5～6 肢、朝镜头大脚掌 + 前蹄叠出「多脚」 | **Agent 目视** | 坐姿四足先验；brief 未锁肢数 |
| `PROP_FLOAT` | 角色旁独立小云/星星贴纸岛 | **Agent 目视** | brief 写了 floating accents |
| `BG_CHECKER` | 棋盘格假透明画进像素 | `qa-skin-raws.py` | 模型爱画 PNG 预览底 |
| `BG_DARK` / `BG_NOT_FLAT` | 深灰棚拍底 / 角不完全白 | `qa-skin-raws.py` | 未压平白底 |
| `MATTE_CORNER` / `MATTE_FILL` | GIF 四角不透或主体占比离谱 | `qa-skin-raws.py --pack` | 假底导致洪水抠图失败 |
| `ID_DRIFT` | 物种/主色漂 | `validate --strict-actions` | 无 ref / edit 漂移 |
| `FRAME_THIN` | 少于 3 帧，或中间帧只眨眼 | 数文件 + 目视 GIF | `FRAMES<3` / `animBeat` 缺失 |

**Identity 哈希过门 ≠ 可交付。**

---

## 视觉自检（Agent 强制）

在 `animate` 之前：

1. 每个 stem 存在 `anim/00` .. `anim/(FRAMES-1).png`（至少到 `02`）
2. `"$CPET/bin/cpet" qa <skinId>`
3. **目视 Read** raw：`idle` · `wave` · `clap` · `dance` · `coffee`
4. **跨表情一致性**：相对 idle 核对耳数、肢数/脚底、主色、脸型、标志物（黄油位/青花纹/像素比例）；哈希过门仍漂移 → 重制该 stem
5. 命中 `LIMB_EXTRA` / `PROP_FLOAT` / 耳数不对 → 修复剧本（idle 中招 → **整包重锁**）

成品后：

5. `"$CPET/bin/cpet" qa <id> --pack <包名>`
6. `"$CPET/bin/cpet" validate --strict-actions <包名>`
7. 目视 GIF：`idle` · `wave` · `clap` · `dance` — **必须看出 01 的肢体/道具在动**

### idle 多候选门

```
→ Read：肢数符合 brief、无 PROP_FLOAT、角近纯白
→ cpet pick <id> <赢家序号>  →  raw/idle.png
→ 禁止第一张 create 直接锁锚
```

---

## 修复剧本

| 代码 | 杠杆 | 动作 |
|------|------|------|
| `LIMB_EXTRA` | brief + Edit | 盖脚/限两前蹄手；idle 坏则重锁后重制其余动作 |
| `PROP_FLOAT` | 删 floating | Edit 删独立贴纸岛；重出该 stem |
| `BG_*` | `cpet sam2` 抠到纯白 | 洪水填白会挖穿浅色衣服；SAM2 失败不要改走 flatten。仍有棋盘格再重出该帧 |
| `MATTE_*` | 先修 raw | 再 animate → qa --pack |
| `FRAME_THIN` | 补帧 | 删非 `00` anim，按目标 `FRAMES`（3～8）提供新图片；或重制整个 stem |

同 stem ≤3 次；仍失败 → 改 brief 设计再重锁 idle。

---

## Identity 门禁（`--strict-actions`）

相对 `idle` 第一帧：

| 指标 | 睁眼态 | 闭眼态（sleeping / petted / yawn…） |
|------|--------|-------------------------------------|
| aHash 汉明距 | ≤ 22 | 不强制 |
| 色直方余弦 | ≥ 0.85 | ≥ 0.82 |
| 轮廓 IoU（居中 64） | ≥ 0.30 | ≥ 0.28 |

## 贴边

- 窗口 peek ≈ 72px；mascot 显示 140×140
- `docked-right` / `docked` = idle 同构图
- `docked-left` = 水平镜像
- **禁止**预裁切半身

## 动画禁区

品红键、半透明叠帧、整图 affine、程序画眼、均匀短 duration、无 ref 散生、**`FRAMES∉[3,8]`**、**中间帧只改眼睛**、**拼图表当成品 raw**。

## 旧包

未齐 20 动作用 `validate --legacy`；新建包必须 `--strict-actions` + `qa-skin-raws` + **FRAMES 3～8 齐套**。
