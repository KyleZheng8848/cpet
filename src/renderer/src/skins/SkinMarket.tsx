import { t as uiText } from '@shared/i18n'
import { useUiLocale } from '../i18n'
import { useEffect, useState } from 'react'
import { SKINS, type SkinId } from '@shared/types'
import type { LocalSkinPack, MarketSkinRow } from '@shared/skinMarket'
import { confirmDestructive } from '../chat/confirm'

type Tab = 'installed' | 'market'

const VECTOR_EMOJI: Partial<Record<SkinId, string>> = {
  violet: '🐻',
  mint: '🐱',
  peach: '🍑',
  slate: '🤖',
  panda: '🐼',
  cow: '🐮',
  kun: '🏀',
  doge: '🐕',
  capy: '🦫',
  frog: '🐸',
  emoji: '😄'
}

function sourceLabel(src: LocalSkinPack['source']): string {
  if (src === 'bundled') return '内置'
  if (src === 'market') return '市场'
  return '本地'
}

export function SkinMarketPanel({
  petSkin,
  imageSkinId,
  onClose,
  onApplied,
  standalone = false
}: {
  petSkin: SkinId
  imageSkinId: string | null
  onClose: () => void
  onApplied?: () => void
  /** 独立皮肤窗：标题栏已有关闭，面板内不再重复「完成」。 */
  standalone?: boolean
}): JSX.Element {
  useUiLocale()
  const [tab, setTab] = useState<Tab>('installed')
  const [local, setLocal] = useState<LocalSkinPack[]>([])
  const [rows, setRows] = useState<MarketSkinRow[]>([])
  const [marketMsg, setMarketMsg] = useState('正在加载市场…')
  const [marketStatus, setMarketStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [activeImage, setActiveImage] = useState<string | null>(imageSkinId)
  const [activeVector, setActiveVector] = useState<SkinId>(petSkin)

  useEffect(() => {
    setActiveImage(imageSkinId)
  }, [imageSkinId])

  useEffect(() => {
    setActiveVector(petSkin)
  }, [petSkin])

  async function reloadLocal(): Promise<void> {
    const packs = await window.petApi.listLocalSkinPacks()
    setLocal(packs)
    const s = await window.petApi.getSettings()
    setActiveImage(s.imageSkin ?? null)
    if (s.skin) setActiveVector(s.skin)
  }

  async function reloadMarket(): Promise<void> {
    setMarketStatus('loading')
    setMarketMsg('正在拉取目录…')
    const r = await window.petApi.fetchSkinMarket()
    setRows(r.rows ?? [])
    setMarketMsg(r.message)
    setMarketStatus(r.status === 'ok' || r.status === 'empty' ? 'ok' : 'error')
    if (r.activeImageSkin !== undefined) setActiveImage(r.activeImageSkin ?? null)
  }

  useEffect(() => {
    void reloadLocal()
  }, [])

  useEffect(() => {
    if (tab === 'market') void reloadMarket()
  }, [tab])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 2200)
    return () => window.clearTimeout(t)
  }, [flash])

  function toast(msg: string): void {
    setFlash(msg)
  }

  function applyVector(id: SkinId): void {
    window.petApi.setImageSkin(null)
    window.petApi.setSkin(id)
    setActiveImage(null)
    setActiveVector(id)
    toast(`已切换：${SKINS.find((s) => s.id === id)?.name ?? id}`)
    onApplied?.()
  }

  function applyImage(id: string): void {
    window.petApi.setImageSkin(id)
    setActiveImage(id)
    toast(`已切换：${id}`)
    onApplied?.()
  }

  async function downloadRow(row: MarketSkinRow): Promise<void> {
    setBusyId(row.entry.id)
    try {
      const r = await window.petApi.downloadSkinPack({
        id: row.entry.id,
        packUrl: row.resolvedPackUrl,
        sha256: row.entry.sha256
      })
      if (!r.ok) {
        toast(r.error)
        return
      }
      await reloadLocal()
      await reloadMarket()
      applyImage(r.id)
      toast(`已安装并应用：${r.id}`)
    } finally {
      setBusyId(null)
    }
  }

  async function uninstall(id: string, source?: string): Promise<void> {
    const bundledNote =
      source === 'bundled'
        ? '\n（内置皮肤卸载后不会自动恢复；可从市场重新下载或重新导入）'
        : ''
    if (
      !confirmDestructive(uiText("卸载皮肤「{0}」？\n文件将从本机皮肤目录删除。{1}", [id, bundledNote]))
    ) {
      return
    }
    setBusyId(id)
    try {
      const r = await window.petApi.uninstallSkinPack(id)
      if (!r.ok) {
        toast(r.error)
        return
      }
      await reloadLocal()
      if (tab === 'market') await reloadMarket()
      toast(`已卸载：${id}`)
      onApplied?.()
    } finally {
      setBusyId(null)
    }
  }

  async function importPack(): Promise<void> {
    setBusyId('__import__')
    try {
      const r = await window.petApi.importSkinPack()
      if (!r.ok) {
        if (r.canceled) return
        toast(r.error)
        return
      }
      await reloadLocal()
      applyImage(r.id)
      toast(`已导入：${r.id}`)
    } finally {
      setBusyId(null)
    }
  }

  async function exportPack(id: string): Promise<void> {
    setBusyId(id)
    try {
      const r = await window.petApi.exportSkinPack(id)
      if (r.ok) {
        toast(`已导出：${r.path}`)
        return
      }
      if (r.canceled) return
      toast(r.error)
    } finally {
      setBusyId(null)
    }
  }

  async function submitPack(id: string): Promise<void> {
    setBusyId(id)
    try {
      const r = await window.petApi.prepareSkinMarketSubmission(id)
      if (!r.ok) {
        if (r.canceled) return
        toast(r.error)
        return
      }
      toast('投稿说明已复制；审核通过后才会出现在市场')
      if (r.issueUrl) window.petApi.openExternal(r.issueUrl)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="skin-market">
      <div className="skin-market-toolbar">
        <div className="skin-market-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            className={tab === 'installed' ? 'on' : ''}
            aria-selected={tab === 'installed'}
            onClick={() => setTab('installed')}
          >
            {uiText("已安装")}</button>
          <button
            type="button"
            role="tab"
            className={tab === 'market' ? 'on' : ''}
            aria-selected={tab === 'market'}
            onClick={() => setTab('market')}
          >
            {uiText("浏览市场")}</button>
        </div>
        <div className="skin-market-head-actions">
          <button
            type="button"
            className="settings-btn ghost tiny"
            disabled={busyId === '__import__'}
            onClick={() => void importPack()}
          >
            {uiText("导入")}</button>
          <button
            type="button"
            className="settings-btn ghost tiny"
            onClick={() => window.petApi.openSkinsDir()}
          >
            {uiText("目录")}</button>
          {standalone ? null : (
            <button type="button" className="settings-btn tiny" onClick={onClose}>
              {uiText("完成")}</button>
          )}
        </div>
      </div>

      {flash ? (
        <div className="skin-market-flash" role="status">
          {flash}
        </div>
      ) : null}

      <div className="skin-market-body">
        {tab === 'installed' ? (
          <>
            <section className="skin-market-section">
              <div className="skin-market-section-row">
                <h3>{uiText("图片皮肤")}</h3>
                <button
                  type="button"
                  className="settings-btn ghost tiny"
                  onClick={() => void reloadLocal()}
                >
                  {uiText("刷新")}</button>
              </div>
              <p className="settings-desc tight">
                {uiText("点卡片即可换肤；默认内置「赛博幽灵」「数字佳人」。自定义包可「投稿到市场」（审核后上架，非即时）。")}</p>
              {!local.length ? (
                <div className="skin-market-empty">
                  <p className="settings-desc">{uiText("还没有图片包。")}</p>
                  <div className="skin-market-head-actions">
                    <button
                      type="button"
                      className="settings-btn tiny"
                      onClick={() => setTab('market')}
                    >
                      {uiText("去市场看看")}</button>
                    <button
                      type="button"
                      className="settings-btn ghost tiny"
                      onClick={() => void importPack()}
                    >
                      {uiText("导入本地包")}</button>
                  </div>
                </div>
              ) : (
                <div className="skin-market-grid">
                  {local.map((p) => {
                    const on = activeImage === p.id
                    return (
                      <article
                        key={p.id}
                        className={`skin-market-card pack ${on ? 'on' : ''}`}
                      >
                        <button
                          type="button"
                          className="skin-market-card-main"
                          onClick={() => applyImage(p.id)}
                        >
                          {p.preview ? (
                            <img src={p.preview} alt="" className="skin-market-thumb" />
                          ) : (
                            <div className="skin-market-thumb placeholder" aria-hidden />
                          )}
                          <span className="skin-market-card-name">{p.name}</span>
                          <span className="skin-market-card-meta">
                            {sourceLabel(p.source)} · {p.states.length} {uiText("状态")}{p.actionCount ? uiText(" · {0} 动作", [p.actionCount]) : ''}
                          </span>
                        </button>
                        <div className="skin-market-card-actions">
                          <button
                            type="button"
                            className="settings-btn ghost tiny"
                            disabled={busyId === p.id}
                            onClick={() => void exportPack(p.id)}
                          >
                            {uiText("导出")}</button>
                          {p.source !== 'bundled' ? (
                            <button
                              type="button"
                              className="settings-btn ghost tiny"
                              disabled={busyId === p.id}
                              title={uiText("导出 zip、复制投稿说明并打开 Issue（审核后才上架）")}
                              onClick={() => void submitPack(p.id)}
                            >
                              {uiText("投稿")}</button>
                          ) : null}
                          <button
                            type="button"
                            className="settings-btn ghost tiny danger"
                            disabled={busyId === p.id}
                            onClick={() => void uninstall(p.id, p.source)}
                          >
                            {uiText("卸载")}</button>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="skin-market-section">
              <h3>{uiText("矢量皮肤")}</h3>
              <p className="settings-desc tight">{uiText("轻量内置形象，随时可切回。")}</p>
              <div className="skin-market-grid vector">
                {SKINS.map((s) => {
                  const on = !activeImage && activeVector === s.id
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`skin-market-card vector-chip ${on ? 'on' : ''}`}
                      onClick={() => applyVector(s.id)}
                    >
                      <span className="skin-market-card-emoji" aria-hidden>
                        {VECTOR_EMOJI[s.id] ?? '🐾'}
                      </span>
                      <span className="skin-market-card-name">{s.name.replace(/\s+[^\s]+$/, '')}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          </>
        ) : (
          <section className="skin-market-section">
            <div className="skin-market-section-row">
              <h3>{uiText("皮肤市场")}</h3>
              <button
                type="button"
                className="settings-btn ghost tiny"
                disabled={marketStatus === 'loading'}
                onClick={() => void reloadMarket()}
              >
                {marketStatus === 'loading' ? uiText("加载中…") : uiText("刷新")}
              </button>
            </div>
            <p className={`settings-desc ${marketStatus === 'error' ? 'skin-market-warn' : ''}`}>
              {marketMsg}
            </p>
            <p className="settings-desc tight">{uiText("下载后立刻可用；自己做的包用顶部「导入」。")}</p>
            {!rows.length && marketStatus === 'ok' ? (
              <p className="settings-desc">{uiText("目录里还没有可下载的包。")}</p>
            ) : null}
            <div className="skin-market-grid">
              {rows.map((row) => (
                <article
                  key={row.entry.id}
                  className={`skin-market-card pack ${
                    activeImage === row.entry.id ? 'on' : ''
                  }`}
                >
                  <div className="skin-market-card-main static">
                    {row.resolvedPreviewUrl ? (
                      <img
                        src={row.resolvedPreviewUrl}
                        alt=""
                        className="skin-market-thumb"
                        loading="lazy"
                      />
                    ) : (
                      <div className="skin-market-thumb placeholder" aria-hidden />
                    )}
                    <span className="skin-market-card-name">{row.entry.name}</span>
                    <span className="skin-market-card-meta">
                      {row.installed ? uiText("已安装") : uiText("未安装")}
                      {row.entry.states?.length ? uiText(" · {0} 状态", [row.entry.states.length]) : ''}
                    </span>
                  </div>
                  <div className="skin-market-card-actions">
                    {row.installed ? (
                      <>
                        <button
                          type="button"
                          className="settings-btn tiny"
                          onClick={() => applyImage(row.entry.id)}
                        >
                          {uiText("应用")}</button>
                        <button
                          type="button"
                          className="settings-btn ghost tiny danger"
                          disabled={busyId === row.entry.id}
                          onClick={() => void uninstall(row.entry.id, row.localSource)}
                        >
                          {uiText("卸载")}</button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="settings-btn tiny"
                        disabled={busyId === row.entry.id}
                        onClick={() => void downloadRow(row)}
                      >
                        {busyId === row.entry.id ? uiText("下载中…") : uiText("下载")}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
