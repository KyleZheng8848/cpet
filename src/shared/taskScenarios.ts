import { t as uiText } from './i18n'
/** 对话形态下的可选模板（非一等任务形态；形态见 Conversation.kind）。 */

import type { AgentAutonomy, Conversation } from './types'

/** 仅用于「对话」形态下的可选模板分组。 */
export type TaskScenarioGroup = 'ship' | 'think' | 'blank'

export interface TaskScenario {
  id: string
  name: string
  desc: string
  group: TaskScenarioGroup
  /** 模板只挂在 chat；对比/流水线/验收单走独立形态入口。 */
  kind: 'chat'
  systemPrompt?: string
  /** 填入输入框，不自动发送（用户补全后发送）。 */
  seedPrompt?: string
  agentAutonomy?: AgentAutonomy
  /** 创建时默认选最近项目目录（仍可在对话框改）。 */
  preferRecentCwd?: boolean
}

export const TASK_SCENARIO_GROUP_LABEL: Record<TaskScenarioGroup, string> = {
  ship: '干活模板',
  think: '想清楚模板',
  blank: '空白'
}

export function autonomyShortLabel(mode?: AgentAutonomy): string {
  switch (mode) {
    case 'agent':
      return uiText("代理")
    case 'plan':
      return uiText("计划")
    case 'ask':
      return uiText("询问")
    default:
      return ''
  }
}

/** 按分组归类；组内保持 BUILTIN 顺序。 */
export function groupTaskScenarios(
  scenarios: ReadonlyArray<TaskScenario> = BUILTIN_TASK_SCENARIOS
): Array<{ group: TaskScenarioGroup; label: string; items: TaskScenario[] }> {
  const order: TaskScenarioGroup[] = ['ship', 'think', 'blank']
  return order
    .map((group) => ({
      group,
      label: TASK_SCENARIO_GROUP_LABEL[group],
      items: scenarios.filter((s) => s.group === group)
    }))
    .filter((g) => g.items.length > 0)
}

/** 对比场景：从已启用模型引用里取 N 列（可循环补齐）。 */
export function pickCompareModelRefs(enabledRefs: string[], columns = 2): string[] {
  if (enabledRefs.length < 1) return []
  const n = Math.min(6, Math.max(2, Math.floor(columns) || 2))
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(enabledRefs[i % enabledRefs.length]!)
  }
  return out
}

/** 把对话模板字段叠进已创建的 Conversation（不改 id / messages）。 */
export function applyTaskScenario(base: Conversation, scenario: TaskScenario): Conversation {
  const next: Conversation = {
    ...base,
    title: scenario.id === 'scene-chat' ? base.title : scenario.name,
    kind: 'chat'
  }
  if (scenario.systemPrompt !== undefined) next.systemPrompt = scenario.systemPrompt
  if (scenario.agentAutonomy !== undefined) next.agentAutonomy = scenario.agentAutonomy
  return next
}

/** 对话形态下的可选模板（不是新任务形态）。 */
export const BUILTIN_TASK_SCENARIOS: ReadonlyArray<TaskScenario> = [
  {
    id: 'scene-skin',
    name: '皮肤生成',
    get desc() { return uiText("按 brief 跑 cpet-cute-skins 出可装包") },
    group: 'ship',
    kind: 'chat',
    preferRecentCwd: true,
    agentAutonomy: 'agent',
    systemPrompt: [
      '你是 CPET 皮肤工厂执行者。用户给出包名与角色设定后，必须先读并遵循 skill `cpet-cute-skins`（仓库 `.cursor/skills/cpet-cute-skins` 或 `~/.cursor/skills/cpet-cute-skins`），用其内脚本与目录表，不要另起一套流程。',
      '开工前：`export CPET=…` 后跑 `"$CPET/bin/cpet" doctor`，不过门先修环境。',
      '硬约束：lifecycle + 20 命名动作；每态 FRAMES=3..8（pose + animBeat + blink）；idle 先锁身份（≥3 候选目视择优）；硬切 GIF；docked 镜像；identity / QA / 帧齐套失败则 fail-closed 禁止交付。',
      '禁 floating props、脏蒙版、肢体错位；禁止跳过校验脚本装模作样交差。',
      '产出：cursor-pet 仓库内落 `assets/skins/<中文包名>/`，其它项目落 `cpet-skins/`（或 `CPET_OUT_DIR`）。交付时给出包路径、缺帧/QA 摘要与如何在设置里选用。'
    ].join('\n'),
    seedPrompt: [
      '请按 cpet-cute-skins 新建一套皮肤。',
      '',
      '包名（中文目录名）：',
      '角色一句话：',
      '外形 / 配色 / 气质：',
      '禁忌（可选，如不要飘浮道具）：',
      '图片来源（已授权的出图工具或本地图片）：',
      'FRAMES（默认 4，范围 3–8）：',
      '',
      '先 doctor，再按 skill 流水线做完并校验。'
    ].join('\n')
  },
  {
    id: 'scene-implement',
    name: '代理干活',
    get desc() { return uiText("在当前项目里实现/修改") },
    group: 'ship',
    kind: 'chat',
    preferRecentCwd: true,
    agentAutonomy: 'agent',
    systemPrompt:
      '你是结对工程师。在当前工作目录内小步修改：先确认目标与边界，再改代码；改完用简短清单说明改了什么、怎么验。禁止扩大到无关文件；高风险（删数据、推远程、改密钥）先说明再动手。',
    seedPrompt: '请在当前项目完成：\n\n目标：\n验收：\n约束（可选）：'
  },
  {
    id: 'scene-fix',
    name: '修 Bug',
    get desc() { return uiText("复现 → 定位 → 最小修复") },
    group: 'ship',
    kind: 'chat',
    preferRecentCwd: true,
    agentAutonomy: 'agent',
    systemPrompt:
      '你是排障工程师。流程：复现现象 → 定位根因 → 最小修复 → 给出验证步骤。先读相关代码/日志再改；不要顺手重构。修完说明根因一句话与回归点。',
    seedPrompt: 'Bug 现象：\n\n复现步骤：\n期望：\n实际：\n相关文件/日志（可选）：'
  },
  {
    id: 'scene-test',
    name: '补测试',
    get desc() { return uiText("为改动或模块补测试") },
    group: 'ship',
    kind: 'chat',
    preferRecentCwd: true,
    agentAutonomy: 'agent',
    systemPrompt:
      '你是测试工程师。优先用仓库现有测试框架与目录约定；覆盖主路径与 1～2 个边界；补充如何运行测试的命令。不改生产逻辑，除非为可测性必须且改动极小。',
    seedPrompt: '请为以下内容补测试：\n\n范围：\n重点用例：\n运行命令（若已知）：'
  },
  {
    id: 'scene-plan',
    name: '方案计划',
    get desc() { return uiText("只出计划，默认不改文件") },
    group: 'think',
    kind: 'chat',
    preferRecentCwd: true,
    agentAutonomy: 'plan',
    systemPrompt:
      '你是务实的技术规划助手。先澄清目标与约束，再给出分步计划、风险与验证方式；默认不要直接改代码，除非用户明确要求执行。',
    seedPrompt: '我想做：\n\n约束：\n成功标准：'
  },
  {
    id: 'scene-review',
    name: '代码审查',
    get desc() { return uiText("询问模式，不擅自改") },
    group: 'think',
    kind: 'chat',
    preferRecentCwd: true,
    agentAutonomy: 'ask',
    systemPrompt:
      '你是资深代码审查员。关注正确性、边界、安全与可维护性；按严重程度排序；每条问题给出改法或示例；没有大问题时也指出可改进点。默认只审查给建议，不要直接改仓库。',
    seedPrompt: '请审查：\n\n（粘贴 diff / 文件路径 / 说明）'
  },
  {
    id: 'scene-chat',
    name: '空白对话',
    get desc() { return uiText("无模板，沿用默认权限") },
    group: 'blank',
    kind: 'chat'
  }
]
