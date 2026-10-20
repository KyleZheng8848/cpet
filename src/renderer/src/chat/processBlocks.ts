import type { ChatBlock } from '@shared/types'
import { attachmentLocalUrl } from '@shared/attachmentMedia'
import {
  canonicalLocalPath,
  extractAttachablePathsFromText,
  extractFilePathFromToolPayload,
  extractLocalImagePaths,
  extractShellOutputPaths,
  filePreviewBasename,
  isAnnouncedSavePath,
  isCpetGeneratedPath,
  isDeliverableFilePath,
  isLocalImagePath,
  isPlausibleLocalPath,
  isResultFilePath,
  isWriteLikeToolName
} from '@shared/filePreview'
import { extractRemoteImageUrls, imageMarkdownForUrls } from '@shared/remoteImages'

/**
 * 把过程旁白从最终回复里拆出（降为 status，受「过程」开关控制）。
 *
 * 只在 done/aborted 写回消息时调用；复制/汇总也用此逻辑取「最终正文」。
 * 展示路径禁止 demote：否则关「过程」时工具一出现，工具前正文会被滤光。
 *
 * - 工具/命令之前的非末段 text → 过程旁白
 * - **永远保留最后一段 text**，避免关「过程」后气泡被掏空
 */
export function demoteProcessText(blocks: ChatBlock[]): ChatBlock[] {
  if (!blocks.length) return blocks

  let lastAction = -1
  let lastText = -1
  let textCount = 0
  for (let i = 0; i < blocks.length; i++) {
    const k = blocks[i].kind
    if (k === 'tool' || k === 'command') lastAction = i
    if (k === 'text') {
      lastText = i
      textCount += 1
    }
  }

  if (lastAction < 0 || lastText < 0) return blocks

  let changed = false
  const next = blocks.map((b, i) => {
    if (b.kind !== 'text') return b
    // 末段正文始终保留，作最终可见回复
    if (i === lastText) return b
    const beforeAction = i < lastAction
    const notFinalText = textCount > 1
    if (beforeAction || notFinalText) {
      changed = true
      return { kind: 'status' as const, text: b.text }
    }
    return b
  })
  return changed ? next : blocks
}

/**
 * 技能报告里「用户点了却没落地」的部分（技能找不到 / 正文被截断）。
 *
 * 技能怎么投递属于过程，关「过程」就该跟着收起来；
 * 但用户显式勾了技能却没生效，是要求没被执行，属于结果，不能被过程开关吞掉。
 * 工具/命令报错不适用：那是模型自己的中间步骤，通常会重试。
 */
export function skillReportUnfulfilled(b: ChatBlock): boolean {
  return b.kind === 'skill' && (b.missing.length > 0 || b.truncated.length > 0)
}

/** 展示用：只去贴纸，不做过程降级。 */
export function visibleAssistantBlocks(blocks: ChatBlock[]): ChatBlock[] {
  return blocks.filter((b) => b.kind !== 'sticker')
}

/**
 * 关掉「过程」时丢掉思考/旁白/工具/命令。
 * 保留全部 text（含工具前旁白原文），避免回合中气泡被掏空。
 * 结束后 demote 只会把非末段 text 降为 status，末段 text 仍在。
 */
export function blocksForDisplay(
  blocks: ChatBlock[],
  showDetails: boolean,
  role: 'user' | 'assistant' | 'system'
): ChatBlock[] {
  const base =
    role === 'assistant' ? visibleAssistantBlocks(blocks) : blocks.filter((b) => b.kind !== 'sticker')
  const produced =
    role === 'assistant' ? collectResultOutputPaths(blocks) : null
  const hadWrites =
    role === 'assistant' &&
    blocks.some(
      (x) => (x.kind === 'tool' && isWriteLikeToolName(x.name)) || x.kind === 'command'
    )
  // 丢掉纯空白 text，避免对比列出现「灰空气泡」却一直显示生成中
  let nontrivial = base.filter((b) => {
    if (b.kind === 'text' || b.kind === 'reasoning' || b.kind === 'status') {
      return Boolean(b.text?.trim())
    }
    if (b.kind === 'attachment') {
      // 假路径（LaTeX 碎片等）一律不展示
      if (!isPlausibleLocalPath(b.path)) return false
      // 助手侧只展示结果文件，历史误挂的素材目录/文件夹直接藏掉
      if (role === 'assistant') {
        if (!isResultFilePath(b.path)) return false
        // 失败命令的 -o 目标从未落地，不展示空卡片（含已写入历史的误挂）
        if (hadWrites && produced) return produced.has(canonicalLocalPath(b.path))
        return true
      }
      return true
    }
    return true
  })
  // 历史消息可能没在 finalize 时挂上：命令输出里的 localPath 图仍要露出来
  if (role === 'assistant' && produced) {
    for (const p of produced) {
      // 图片交给下方 promoteOutputImages 进 Markdown；这里只补非图附件
      if (isLocalImagePath(p)) continue
      nontrivial = ensureAttachmentBlock(nontrivial, p)
    }
  }
  if (role === 'assistant') {
    nontrivial = omitRedundantImageAttachments(promoteOutputImages(nontrivial))
  }
  if (showDetails) return nontrivial
  return nontrivial.filter(
    (b) =>
      b.kind === 'text' ||
      b.kind === 'attachment' ||
      b.kind === 'sticker' ||
      skillReportUnfulfilled(b) ||
      (b.kind === 'status' && b.pin)
  )
}

/**
 * 收尾：仅合并相邻同型 text/reasoning/status。
 * 不做语义去重、不从思考里「猜」最终回复。
 */
export function collapseStreamArtifacts(blocks: ChatBlock[]): ChatBlock[] {
  if (!blocks.length) return blocks

  const merged: ChatBlock[] = []
  for (const b of blocks) {
    const last = merged[merged.length - 1]
    if (
      last &&
      last.kind === b.kind &&
      (b.kind === 'text' || b.kind === 'reasoning' || b.kind === 'status')
    ) {
      merged[merged.length - 1] = {
        ...last,
        text: (last as { text: string }).text + (b as { text: string }).text
      } as ChatBlock
    } else {
      merged.push(b)
    }
  }
  return merged
}

/**
 * 若只有思考没有正文，把思考末段提升为可见回复。
 * 避免关「过程」后气泡空白，也避免模型把整段答进 thinking。
 */
export function ensureAssistantText(blocks: ChatBlock[]): ChatBlock[] {
  if (blocks.some((b) => b.kind === 'text' && b.text.trim())) return blocks
  const reasoning = blocks
    .filter((b): b is Extract<ChatBlock, { kind: 'reasoning' }> => b.kind === 'reasoning')
    .map((b) => b.text.trim())
    .filter(Boolean)
  if (!reasoning.length) return blocks
  const combined = reasoning.join('\n\n')
  const paras = combined
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  let reply = paras[paras.length - 1] || combined
  // 去掉常见思考元叙述行，尽量留下对用户说的话
  reply = reply
    .split('\n')
    .filter((line) => !/^(用户再次问候|用户发来了问候|用户问候|Prepare to reply|I'll reply)/i.test(line.trim()))
    .join('\n')
    .trim()
  if (!reply) reply = paras[paras.length - 1] || combined
  return [...blocks, { kind: 'text', text: reply }]
}

/** 命令真正写出了文件：跑完且退出码不是失败。 */
export function commandSucceeded(
  b: Pick<Extract<ChatBlock, { kind: 'command' }>, 'status' | 'exitCode'>
): boolean {
  if (b.status === 'error' || b.status === 'running') return false
  if (typeof b.exitCode === 'number' && b.exitCode !== 0) return false
  return b.status === 'done'
}

function collectResultOutputPaths(blocks: ChatBlock[]): Set<string> {
  const resultPaths = new Set<string>()
  const push = (p: string | null | undefined): void => {
    const path = canonicalLocalPath(p || '')
    if (!path || !isResultFilePath(path)) return
    resultPaths.add(path)
  }
  for (const b of blocks) {
    if (b.kind === 'tool') {
      if (b.status === 'error') continue
      if (isWriteLikeToolName(b.name)) {
        push(extractFilePathFromToolPayload(b.input, b.output))
      }
      if (b.output) {
        for (const p of extractLocalImagePaths(b.output)) push(p)
      }
      continue
    }
    if (b.kind === 'command') {
      if (!commandSucceeded(b)) continue
      for (const p of extractShellOutputPaths(b.command || '')) push(p)
      const blob = `${b.command || ''}\n${b.output || ''}`
      if (b.output) {
        for (const p of extractLocalImagePaths(b.output)) push(p)
      }
      for (const p of extractAttachablePathsFromText(blob)) {
        if (isDeliverableFilePath(p)) push(p)
      }
      continue
    }
    if (b.kind === 'text' && b.text) {
      for (const p of extractAttachablePathsFromText(b.text)) {
        if (isCpetGeneratedPath(p) || isAnnouncedSavePath(b.text, p)) push(p)
      }
    }
  }
  return resultPaths
}

/** 若消息里还没有该路径的附件块，则追加（仅结果文件）。 */
export function ensureAttachmentBlock(blocks: ChatBlock[], path: string): ChatBlock[] {
  const p = canonicalLocalPath(path)
  if (!p || !isResultFilePath(p)) return blocks
  if (blocks.some((b) => b.kind === 'attachment' && canonicalLocalPath(b.path) === p)) {
    return blocks
  }
  return [
    ...blocks,
    {
      kind: 'attachment' as const,
      path: p,
      name: filePreviewBasename(p)
    }
  ]
}

/**
 * 只挂本回合「结果文件」：
 * - Write/Edit 等写入工具的目标路径
 * - Shell 的 -o / > 写出目标，以及命令里的交付物路径
 * - 正文里技能输出目录，或「保存至」点名的文件
 * 不扫正文里的素材目录、origin.csv 等过程路径；并去掉已误挂的非结果附件。
 */
export function promoteOutputAttachments(blocks: ChatBlock[]): ChatBlock[] {
  if (!blocks.length) return blocks
  const resultPaths = collectResultOutputPaths(blocks)

  // 去掉过程/假路径附件；再补上结果文件
  let next = blocks.filter((b) => {
    if (b.kind !== 'attachment') return true
    const key = canonicalLocalPath(b.path)
    if (!isPlausibleLocalPath(key) || !isResultFilePath(key)) return false
    // 有写入结果则只留结果集；没有则清掉（避免正文扫出来的残留）
    if (resultPaths.size === 0) return false
    return resultPaths.has(key)
  })
  for (const p of resultPaths) next = ensureAttachmentBlock(next, p)
  return next
}

/** 命令/工具返回了图片 URL，但模型没写成 Markdown 时，补进可见正文。 */
export function ensureImageMarkdown(blocks: ChatBlock[], urls: string[]): ChatBlock[] {
  const unique = [...new Set(urls.filter(Boolean))]
  if (!unique.length) return blocks
  const existing = blocks
    .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n')
  // 正文里只「提到」URL 不够；必须已有 ![…](url) 才算展示过
  const missing = unique.filter((u) => !existing.includes(`](${u})`))
  if (!missing.length) return blocks
  const chunk = imageMarkdownForUrls(missing)
  const lastText = [...blocks].reverse().findIndex((b) => b.kind === 'text')
  if (lastText >= 0) {
    const idx = blocks.length - 1 - lastText
    const cur = blocks[idx]
    if (cur.kind === 'text') {
      const next = [...blocks]
      next[idx] = { kind: 'text', text: `${cur.text.trim()}\n\n${chunk}` }
      return next
    }
  }
  return [...blocks, { kind: 'text', text: chunk }]
}

/** 本地图路径 → cpet-file Markdown，避免只写路径/localhost 代理导致空白图框。 */
export function ensureLocalImageMarkdown(blocks: ChatBlock[], paths: string[]): ChatBlock[] {
  const unique = [
    ...new Set(
      paths
        .map((p) => canonicalLocalPath(p))
        .filter((p): p is string => Boolean(p && isLocalImagePath(p)))
    )
  ]
  if (!unique.length) return blocks
  const existing = blocks
    .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n')
  const missing = unique.filter((p) => {
    const url = attachmentLocalUrl(p)
    if (existing.includes(url)) return false
    // 已有指向该路径的 markdown 图（哪怕 src 是坏的 localhost）→ 交给 sanitize 改写即可
    if (existing.includes(p) && /!\[[^\]]*\]\([^)\n]+\)/.test(existing)) return false
    return true
  })
  if (!missing.length) return blocks
  const chunk = missing.map((p, i) => `![生成图 ${i + 1}](${attachmentLocalUrl(p)})`).join('\n\n')
  const lastText = [...blocks].reverse().findIndex((b) => b.kind === 'text')
  if (lastText >= 0) {
    const idx = blocks.length - 1 - lastText
    const cur = blocks[idx]
    if (cur.kind === 'text') {
      const next = [...blocks]
      next[idx] = { kind: 'text', text: `${cur.text.trim()}\n\n${chunk}` }
      return next
    }
  }
  return [...blocks, { kind: 'text', text: chunk }]
}

/** 正文里 `![](…)` 真正指向的本地路径集合。只提到路径不算。 */
function markdownImageTargets(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const src = (m[1] || '').trim()
    if (!src) continue
    const q = src.match(/[?&]p=([^&]+)/)
    if (q?.[1]) {
      let decoded = q[1]
      try {
        decoded = decodeURIComponent(q[1])
      } catch {
        /* keep raw */
      }
      const key = canonicalLocalPath(decoded)
      if (key) out.add(key)
      continue
    }
    const key = canonicalLocalPath(src)
    if (key) out.add(key)
  }
  return out
}

/**
 * 正文 Markdown 是否已在展示该本地图（避免同图再挂附件卡显示两遍）。
 * 必须是真的插了图；只在文字里写出路径不算，否则模型「只报路径」时图会彻底消失。
 */
export function localImageShownInMarkdown(blocks: ChatBlock[], path: string): boolean {
  const key = canonicalLocalPath(path)
  if (!key) return false
  const text = blocks
    .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n')
  if (!text.trim()) return false
  return markdownImageTargets(text).has(key)
}

/** 已有 Markdown 插图时去掉同路径附件卡（气泡里「大图 + 缩略图芯片」双显）。 */
export function omitRedundantImageAttachments(blocks: ChatBlock[]): ChatBlock[] {
  return blocks.filter((b) => {
    if (b.kind !== 'attachment') return true
    if (!isLocalImagePath(b.path)) return true
    return !localImageShownInMarkdown(blocks, b.path)
  })
}

export function promoteOutputImages(blocks: ChatBlock[]): ChatBlock[] {
  const urls: string[] = []
  const locals: string[] = []
  for (const b of blocks) {
    if (b.kind === 'command' && commandSucceeded(b)) {
      const blob = `${b.command || ''}\n${b.output || ''}`
      urls.push(...extractRemoteImageUrls(b.output || ''))
      locals.push(...extractLocalImagePaths(blob))
    }
    if (b.kind === 'tool' && b.status === 'done' && b.output) {
      urls.push(...extractRemoteImageUrls(b.output))
      locals.push(...extractLocalImagePaths(b.output))
    }
    if (b.kind === 'text' && b.text) {
      urls.push(...extractRemoteImageUrls(b.text))
      locals.push(...extractLocalImagePaths(b.text))
    }
  }
  let next = ensureLocalImageMarkdown(ensureImageMarkdown(blocks, urls), locals)
  // 非图片 / 未能进 Markdown 的图才挂附件卡；右侧「本对话文件」仍会从正文扫路径
  for (const p of locals) {
    if (isLocalImagePath(p) && localImageShownInMarkdown(next, p)) continue
    next = ensureAttachmentBlock(next, p)
  }
  return omitRedundantImageAttachments(next)
}

/** done/aborted 时：合并碎片，拆过程旁白，保证正文，并把产出文件挂成附件。 */
export function finalizeAssistantBlocks(blocks: ChatBlock[]): ChatBlock[] {
  return promoteOutputImages(
    promoteOutputAttachments(
      demoteProcessText(ensureAssistantText(collapseStreamArtifacts(blocks)))
    )
  )
}

/**
 * 主进程 done.result 兜底：流式片丢失/封口后，气泡可能只剩 usage、没有 text。
 * 有终局字符串且当前无可读正文时写入；终局明显更长时覆盖过短碎片。
 */
export function applyDoneResult(blocks: ChatBlock[], result?: string): ChatBlock[] {
  const text = typeof result === 'string' ? result.trim() : ''
  if (!text) return promoteOutputImages(promoteOutputAttachments(blocks))
  const existing = blocks
    .filter((b): b is Extract<ChatBlock, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text.trim())
    .filter(Boolean)
  const joined = existing.join('\n\n')
  if (!joined) {
    return promoteOutputImages(promoteOutputAttachments([...blocks, { kind: 'text', text }]))
  }
  // 流式已不短于终局 → 保留；终局更长则覆盖（避免半截正文卡住）
  if (joined.length >= text.length) {
    return promoteOutputImages(promoteOutputAttachments(blocks))
  }
  const rest = blocks.filter((b) => b.kind !== 'text')
  return promoteOutputImages(promoteOutputAttachments([...rest, { kind: 'text', text }]))
}
