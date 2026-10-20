import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ModelProvider } from '@shared/types'
import { groupedEnabledModels, isAgentModelRef, isAgentProvider, modelRefLabel } from '@shared/models'

type ModelGroup = ReturnType<typeof groupedEnabledModels>[number]

function filterGroups(groups: ModelGroup[], query: string): ModelGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups
    .map((g) => {
      const providerHit =
        g.providerLabel.toLowerCase().includes(q) || g.providerId.toLowerCase().includes(q)
      const models = providerHit
        ? g.models
        : g.models.filter(
            (m) =>
              m.label.toLowerCase().includes(q) ||
              m.modelId.toLowerCase().includes(q) ||
              m.ref.toLowerCase().includes(q)
          )
      return models.length ? { ...g, models } : null
    })
    .filter((g): g is ModelGroup => !!g)
}

/** 触发器文案：始终「供应商：模型」。 */
function triggerLabel(providers: ModelProvider[], ref: string): string {
  return modelRefLabel(providers, ref)
}

function SectionHeading({ children }: { children: string }): JSX.Element {
  useUiLocale()
  return (
    <li className="model-tree-section" role="presentation">
      {children}
    </li>
  )
}

export type ModelPickerScope = 'all' | 'api' | 'agent'

/** 树状模型浏览（可搜索、可折叠），用于下拉与新建对比。按 Agent / 直连分区。 */
export function ModelTreeBrowser({
  providers,
  selectedRef,
  onSelect,
  actionLabel,
  onAction,
  autoExpandSelected = false,
  compact,
  scope = 'all',
  /** Agent 行展示但不可选（少数场景禁用 CLI）。 */
  disableAgents,
  disableAgentReason = '当前场景不可用 Agent'
}: {
  providers: ModelProvider[]
  selectedRef?: string
  onSelect?: (ref: string) => void
  /** 叶子操作按钮文案（如「添加」）；有则显示按钮而非整行选中。 */
  actionLabel?: string
  onAction?: (ref: string) => void
  /** 是否自动展开当前选中所在分组；默认否（全部折叠，搜索时仍全开）。 */
  autoExpandSelected?: boolean
  compact?: boolean
  /** all=双区；api=仅大模型直连；agent=仅 Agent 引擎。 */
  scope?: ModelPickerScope
  disableAgents?: boolean
  disableAgentReason?: string
}): JSX.Element {
  useUiLocale()
  const groups = useMemo(() => groupedEnabledModels(providers), [providers])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const searchRef = useRef<HTMLInputElement>(null)
  const filtered = useMemo(() => filterGroups(groups, query), [groups, query])
  const searching = query.trim().length > 0
  const agentGroups = useMemo(() => {
    if (scope === 'api') return []
    return filtered.filter((g) => isAgentProvider(g))
  }, [filtered, scope])
  const apiGroups = useMemo(() => {
    if (scope === 'agent') return []
    return filtered.filter((g) => !isAgentProvider(g))
  }, [filtered, scope])

  useEffect(() => {
    if (!autoExpandSelected || !selectedRef) return
    const providerId = selectedRef.split(':')[0]
    if (!providerId) return
    setExpanded((prev) => (prev[providerId] ? prev : { ...prev, [providerId]: true }))
  }, [selectedRef, autoExpandSelected])

  useEffect(() => {
    // 打开面板后尽快聚焦搜索
    const t = window.setTimeout(() => searchRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [])

  function isOpen(providerId: string): boolean {
    // 搜索时展开匹配组，便于点选；平时全部折叠，需手动点开
    if (searching) return true
    return !!expanded[providerId]
  }

  function toggle(providerId: string): void {
    setExpanded((prev) => ({ ...prev, [providerId]: !isOpen(providerId) }))
  }

  function renderGroup(g: ModelGroup): JSX.Element {
    const open = isOpen(g.providerId)
    const agentGroup = isAgentProvider(g)
    const groupDisabled = Boolean(disableAgents && agentGroup)
    return (
      <li key={g.providerId} className="model-tree-group" role="treeitem" aria-expanded={open}>
        <button
          type="button"
          className="model-tree-provider"
          onClick={() => toggle(g.providerId)}
          aria-expanded={open}
        >
          <span className="model-tree-chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
          <span className="model-tree-provider-name">{g.providerLabel}</span>
          <span className="model-tree-count">{g.models.length}</span>
        </button>
        {open && (
          <ul className="model-tree-children" role="group">
            {g.models.map((m) => {
              const selected = selectedRef === m.ref
              const disabled = groupDisabled
              return (
                <li key={m.ref} role="treeitem">
                  {actionLabel && onAction && !disabled ? (
                    <div className={`model-tree-leaf row ${selected ? 'on' : ''}`}>
                      <button
                        type="button"
                        className="model-tree-leaf-main"
                        title={m.ref}
                        onClick={() => onAction(m.ref)}
                      >
                        <span className="model-tree-leaf-body">
                          <span className="model-tree-leaf-label">{m.label}</span>
                          {!compact ? (
                            <code className="model-tree-leaf-id">{m.modelId}</code>
                          ) : null}
                        </span>
                        {selected ? (
                          <span className="model-tree-leaf-check" aria-hidden>
                            ✓
                          </span>
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="settings-btn ghost tiny"
                        onClick={() => onAction(m.ref)}
                      >
                        {actionLabel}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`model-tree-leaf ${selected ? 'on' : ''}${
                        disabled ? ' is-disabled' : ''
                      }`}
                      title={disabled ? `${disableAgentReason}（${m.ref}）` : m.ref}
                      aria-current={selected ? 'true' : undefined}
                      aria-disabled={disabled || undefined}
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return
                        onSelect?.(m.ref)
                      }}
                    >
                      <span className="model-tree-leaf-body">
                        <span className="model-tree-leaf-label">{m.label}</span>
                        {!compact ? (
                          <code className="model-tree-leaf-id">{m.modelId}</code>
                        ) : null}
                      </span>
                      {selected ? (
                        <span className="model-tree-leaf-check" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </li>
    )
  }

  if (!agentGroups.length && !apiGroups.length) {
    return <p className="model-tree-empty">{uiText("无可用模型，请先在设置中启用。")}</p>
  }

  return (
    <div className={`model-tree ${compact ? 'compact' : ''}`}>
      <div className="model-tree-search">
        <input
          ref={searchRef}
          type="search"
          className="model-tree-search-input"
          placeholder={uiText("搜索提供商或模型…")}
          value={query}
          aria-label={uiText("搜索模型")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (query) {
                e.stopPropagation()
                setQuery('')
              }
            }
          }}
        />
      </div>
      {filtered.length === 0 ? (
        <p className="model-tree-empty">{uiText("无匹配结果")}</p>
      ) : (
        <ul className="model-tree-list" role="tree">
          {agentGroups.length > 0 && (
            <>
              <SectionHeading>{uiText("Agent 引擎")}</SectionHeading>
              {agentGroups.map(renderGroup)}
            </>
          )}
          {apiGroups.length > 0 && (
            <>
              <SectionHeading>{uiText("大模型直连")}</SectionHeading>
              {apiGroups.map(renderGroup)}
            </>
          )}
        </ul>
      )}
    </div>
  )
}

/** 按提供商树状分组的模型选择器（可搜索折叠）。 */
export function ModelPicker({
  providers,
  value,
  onChange,
  disabled,
  className,
  title,
  onOpen,
  scope = 'all',
  disableAgents,
  disableAgentReason,
  allowEmpty,
  emptyLabel = '不使用模型',
  hideKind = false
}: {
  providers: ModelProvider[]
  value: string
  onChange: (ref: string) => void
  disabled?: boolean
  className?: string
  title?: string
  /** 展开选单时回调（可用于拉取本机引擎模型目录）。 */
  onOpen?: () => void
  scope?: ModelPickerScope
  disableAgents?: boolean
  disableAgentReason?: string
  /** 允许清空（用于评分/简报「模板骨架」）。 */
  allowEmpty?: boolean
  emptyLabel?: string
  /** 窄栏隐藏「直连/Agent」徽章，与普通下拉对齐。 */
  hideKind?: boolean
}): JSX.Element {
  useUiLocale()
  const groups = useMemo(() => {
    const all = groupedEnabledModels(providers)
    if (scope === 'api') return all.filter((g) => !isAgentProvider(g))
    if (scope === 'agent') return all.filter((g) => isAgentProvider(g))
    return all
  }, [providers, scope])
  const flat = useMemo(() => groups.flatMap((g) => g.models), [groups])
  // 优先展示当前任务已选引用；允许空值时不要偷偷换成第一个
  const safeValue = value || (allowEmpty ? '' : flat[0]?.ref || '')
  const valueInList = !safeValue || flat.some((m) => m.ref === safeValue)
  const [open, setOpen] = useState(false)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(
    null
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  function placePanel(): void {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.min(320, Math.max(r.width, 240), window.innerWidth - 16)
    let left = r.left
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8)
    const below = r.bottom + 4
    const panelH = Math.min(360, window.innerHeight * 0.55)
    const top =
      below + panelH > window.innerHeight - 8
        ? Math.max(8, r.top - panelH - 4)
        : below
    setPanelPos({ top, left, width })
  }

  useEffect(() => {
    if (!open) return
    placePanel()
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onReposition = (): void => placePanel()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [open])

  const display = !safeValue
    ? emptyLabel
    : triggerLabel(providers, safeValue) + (valueInList ? '' : ' · 未启用')
  const fullTitle = title || (safeValue ? modelRefLabel(providers, safeValue) : emptyLabel)
  const isAgent = safeValue ? isAgentModelRef(providers, safeValue) : false
  const hasAny = flat.length > 0 || !!safeValue || !!allowEmpty

  const panel =
    open && panelPos
      ? createPortal(
          <div
            ref={panelRef}
            className="model-picker-panel"
            role="listbox"
            aria-label={uiText("模型树")}
            style={{
              top: panelPos.top,
              left: panelPos.left,
              width: panelPos.width
            }}
          >
            {allowEmpty ? (
              <button
                type="button"
                className={`model-picker-empty${safeValue ? '' : ' on'}`}
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                {emptyLabel}
              </button>
            ) : null}
            <ModelTreeBrowser
              providers={providers}
              selectedRef={safeValue}
              compact
              scope={scope}
              disableAgents={disableAgents}
              disableAgentReason={disableAgentReason}
              onSelect={(ref) => {
                if (disableAgents && isAgentModelRef(providers, ref)) return
                onChange(ref)
                setOpen(false)
              }}
            />
          </div>,
          document.body
        )
      : null

  return (
    <div
      className={`model-picker-wrap ${open ? 'open' : ''} ${className || ''}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="model-picker-trigger"
        disabled={disabled || !hasAny}
        title={fullTitle}
        aria-label={uiText("选择模型")}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() =>
          setOpen((v) => {
            const next = !v
            if (next) onOpen?.()
            return next
          })
        }
      >
        {!hideKind && safeValue ? (
          <span className={`model-picker-kind ${isAgent ? 'is-agent' : 'is-api'}`}>
            {isAgent ? 'Agent' : uiText("直连")}
          </span>
        ) : null}
        {!hideKind && !safeValue && allowEmpty ? (
          <span className="model-picker-kind is-empty">{uiText("无")}</span>
        ) : null}
        <span className="model-picker-trigger-text">
          {hasAny ? display : uiText("无可用模型")}
        </span>
        <span className="model-picker-caret" aria-hidden>
          {open ? '▴' : '▾'}
        </span>
      </button>
      {panel}
    </div>
  )
}
