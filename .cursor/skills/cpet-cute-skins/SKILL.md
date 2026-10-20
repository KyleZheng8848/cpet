---
name: cpet-cute-skins
description: >-
  Prepare CPET image-skin briefs, lock an idle identity, and process supplied PNG
  keyframes into GIF skin packs with local cutout, visual QA, validation and
  installation. Use for CPET skin.json, lifecycle/action frames or image-skin packs.
---

# CPET 图片皮肤工具

本技能只处理本地图片；通过当前环境中已授权的出图工具生成图片，或使用用户提供的图片。
脚本无需生图 API Key，也不安装或调用第三方出图 CLI。

```bash
export CPET="<本技能目录的绝对路径>"
"$CPET/bin/cpet" doctor
"$CPET/bin/cpet" paths
```

默认产出到当前项目 `cpet-skins/`；cursor-pet 仓库内沿用 `assets/skins/`。
用 `CPET_OUT_DIR` 指定其它目录。路径解析停止于当前项目根。

1. `cpet new --id <id> --name <包名> --prompt "<角色设定>"` 创建 brief。
2. 根据 [catalogs/LIFECYCLE.json](catalogs/LIFECYCLE.json) 和
   [catalogs/ACTION_CATALOG.json](catalogs/ACTION_CATALOG.json) 的 pose/animBeat 制作图片。
   真人参考需保留本人身份；把至少 3 个 idle 候选放入 `_work/<id>/_idle_cands/idle-1.png` 等路径，展示后按用户选择运行 `cpet pick <id> <n>`。
3. 以锁住的 `raw/idle.png` 为参考制作其余 `raw/<stem>.png` 和
   `anim/<stem>/00.png` 至最后一帧。每个 stem 需 3～8 帧，默认 4：00 为主姿势，
   中间帧有肢体/道具运动，最后一帧眨眼或闭眼副拍。仅生成用户要求的动作。
4. `cpet qa <id>`，并目视 idle/wave/clap/dance/coffee 的肢数、身份、背景及漂浮物；
   发现多肢、抠穿衣服或动作错误时先修复。哈希通过不能替代目视。
5. `cpet gif <id>` → `cpet dock <包名>` → `cpet qa <id> --pack <包名>` →
   `cpet validate --strict-actions <包名>`。缺帧、身份或 QA 不通过时不得交付。
6. `cpet install <包名>` 安装到 CPET 的 userData，然后完全退出应用再启动。

本地抠图可用 `cpet sam2 <png>...`（需要 SAM2 与权重）；
`cpet flatten <png>...` 是旧洪水填白，会吃掉浅色衣服，不宜用于人物抠图。
`cpet sync [dest]` 同步技能副本，仅在用户要求同步时执行。

帧契约、缺陷分类和修复方法见 [reference.md](reference.md)。
角色 brief 示例见 [examples/skin.json.example](examples/skin.json.example)。
Python 使用 `CPET_PYTHON` 或 python3，需要 Pillow、numpy。
