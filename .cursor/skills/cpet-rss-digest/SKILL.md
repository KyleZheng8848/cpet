---
name: cpet-rss-digest
description: |
  CPET RSS 简报写稿：12 形态全覆盖（brief/daily/flash/followup/risks/action/full/changes/wechat/xhs/report/script）。
  每形态独立 forms/*.md；共用 craft：价值门槛、主线聚焦、去 AI 味、来源只引用。
  触发：简报生成、digest、日报/周报/决策/风险/行动/公众号/小红书/研报/口播。
---

# cpet-rss-digest：CPET 简报写稿

把订阅条目写成**有主线、值得读、能停住**的中文 Markdown，不是条目小票。

## 真源

| 路径 | 作用 |
|------|------|
| `references/craft.md` | 全形态：格式硬性 + 价值门槛 + 主线 + 去 AI 味 |
| `forms/<id>.md` | 单一形态：结构、写法、好坏例、自检（12 个同等强度） |

形态 id（稳定）：`brief` · `daily` · `flash` · `followup` · `risks` · `action` · `full` · `changes` · `wechat` · `xhs` · `report` · `script`

## 对话用法

1. 确认形态 id（默认 `brief`）。
2. 先读 `references/craft.md`，再读 `forms/<id>.md`。
3. 只用给定条目 URL；按形态结构输出；文末资料来源 = 正文引用。
4. 对照该形态「自检」勾完再交付。

## 应用内用法

`buildRssDigestReport` = `craft.md` + `forms/<template>.md` 作 system。改效果只改本 skill。

## 形态速查

| id | 标签 | 核心标准 |
|----|------|----------|
| brief | 头条速览 | 一条主线，对象+利害，宁缺毋滥 |
| daily | 三句话日报 | 同议题三侧面 + 可勾选行动 |
| flash | 60秒快讯 | 一行一事，禁气氛组 |
| followup | 决策简报 | 信号→影响→盯谁（带动作类型） |
| risks | 风险雷达 | 类型+后果+按本周动作分紧迫度 |
| action | 行动清单 | 可验收待办，禁伪待办 |
| full | 主题周报 | 主线周记，有料才开分类 |
| changes | 变动清单 | 每条能答从旧到新 |
| wechat | 公众号长文 | 单主线叙事，结语可带走 |
| xhs | 小红书笔记 | 单主题钩子，互动好接 |
| report | 行业研报 | 一命题+论证链+风险 |
| script | 口播脚本 | 能念、有增量、单一 CTA |
