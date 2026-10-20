import { app, BrowserWindow, screen, session, shell } from 'electron'
import { join } from 'node:path'
import { IPC, type PetDockEdge } from '../shared/types'

const isDev = !!process.env['ELECTRON_RENDERER_URL']
const RENDERER_URL = process.env['ELECTRON_RENDERER_URL']

const PET_SIZE = { width: 280, height: 300 }
/** 快速对话条展开时窗口额外高度（向上长，本体屏上位置不变；含回复正文区）。 */
const PET_QUICK_CHAT_EXTRA_H = 240
/** 待办审批卡展开时窗口额外宽度（向左长，本体屏上位置不变）。 */
const PET_ATTN_EXTRA_W = 160
const CHAT_SIZE = { width: 720, height: 700 }
const SKINS_SIZE = { width: 440, height: 620 }

/**
 * 贴边半隐藏时留在屏内的可见宽度。
 * 与渲染侧 .mascot-img 140px 对齐：约露出半只，避免 40px 裁成「大脸竖条」。
 */
const PET_DOCK_PEEK = 72
/** 拖拽松手时：探出超过该值，或贴边过近，则收起。 */
const PET_DOCK_TRIGGER = 36
/** 悬停展开后与工作区边缘的间距。 */
const PET_DOCK_EXPAND_GAP = 10
/** 拖拽时允许探出屏外的余量（便于甩到边缘收起）。 */
const PET_DRAG_TOP_SLACK = Math.round(PET_SIZE.height * 0.62)
const PET_DRAG_EDGE_SLACK = Math.round(PET_SIZE.width * 0.62)

let petWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let skinsWindow: BrowserWindow | null = null
/** 退出中才真正销毁对话窗；平时关窗只隐藏，避免快问「对话窗未就绪」。 */
let appQuitting = false
let onChatWindowClosed: (() => void) | null = null
/** Vite 全量重启 / HMR 挂死后常只剩米色底；限制自动 reload 次数避免死循环。 */
let chatBootReloadAttempts = 0
let chatLastFinishLoadAt = 0
const MAX_CHAT_BOOT_RELOADS = 2
/** 首屏挂载宽限：占位文案还在时不要立刻判空重载。 */
const CHAT_BOOT_GRACE_MS = 2200

type ChatBootInfo = {
  htmlLen: number
  childCount: number
  title: string
  err: string | null
  hasShell: boolean
  placeholderOnly: boolean
}

async function probeChatBoot(win: BrowserWindow): Promise<ChatBootInfo | null> {
  try {
    return (await win.webContents.executeJavaScript(
      `(() => {
        const root = document.getElementById('root');
        const shell = root && root.querySelector('.chat-root');
        const ph = root && root.querySelector('[data-cpet-boot]');
        return {
          htmlLen: root ? root.innerHTML.length : -1,
          childCount: root ? root.childElementCount : -1,
          title: document.title,
          err: window.__CPET_BOOT_ERROR || null,
          hasShell: !!shell,
          placeholderOnly: !!ph && !shell
        };
      })()`
    )) as ChatBootInfo
  } catch (err) {
    console.error('[window:chat] boot probe failed', err)
    return null
  }
}

function chatUiLooksBlank(info: ChatBootInfo): boolean {
  if (info.hasShell) return false
  if (info.placeholderOnly) return true
  // 错误边界页没有 .chat-root，preload 过期一类的挂死要重载，次数由 MAX_CHAT_BOOT_RELOADS 封顶
  if (info.err) return true
  if (info.childCount <= 0) return true
  // 仅底色 / 极短占位，没有 .chat-root
  return info.htmlLen < 120
}

async function healChatIfBlank(win: BrowserWindow, reason: string): Promise<void> {
  if (!isDev || !win || win.isDestroyed()) return
  const info = await probeChatBoot(win)
  if (!info) return
  console.log('[window:chat] boot probe', { reason, ...info })
  if (!chatUiLooksBlank(info)) {
    chatBootReloadAttempts = 0
    return
  }
  const age = Date.now() - chatLastFinishLoadAt
  if (age < CHAT_BOOT_GRACE_MS) {
    console.log('[window:chat] boot still mounting', { reason, age, ...info })
    return
  }
  if (chatBootReloadAttempts >= MAX_CHAT_BOOT_RELOADS) {
    console.error('[window:chat] still blank after reloads', { reason, ...info })
    return
  }
  chatBootReloadAttempts += 1
  console.warn('[window:chat] blank UI — reloading', {
    reason,
    attempt: chatBootReloadAttempts,
    ...info
  })
  win.webContents.reload()
}

function scheduleChatBootHeal(win: BrowserWindow): void {
  if (!isDev) return
  for (const ms of [500, 1800, 4000]) {
    setTimeout(() => {
      void healChatIfBlank(win, `delayed:${ms}`)
    }, ms)
  }
}

export function setAppQuitting(quitting: boolean): void {
  appQuitting = quitting
}

export function setChatWindowClosedHandler(handler: (() => void) | null): void {
  onChatWindowClosed = handler
}

type DockEdge = Exclude<PetDockEdge, null>
let dockEdge: DockEdge | null = null
let dockExpanded = false
let dockWatch: NodeJS.Timeout | null = null
let dockCollapseTimer: NodeJS.Timeout | null = null
/** 收起后短时禁止再展开，打断「收起→仍在边缘→立刻展开」震荡。 */
let dockExpandArmedAt = 0
let dragInterval: NodeJS.Timeout | null = null
const DOCK_COLLAPSE_MS = 900
const DOCK_EXPAND_COOLDOWN_MS = 450

function loadRoute(win: BrowserWindow, route: 'pet' | 'chat' | 'skins'): void {
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[window:${route}] did-fail-load`, { code, desc, url })
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[window:${route}] render-process-gone`, details)
  })
  win.webContents.on('console-message', (_e, details) => {
    const d = details as { level?: number; message?: string; lineNumber?: number; sourceId?: string }
    if ((d.level ?? 0) < 2) return
    console.error(
      `[window:${route}:console]`,
      d.message || details,
      d.sourceId ? `(${d.sourceId}:${d.lineNumber ?? '?'})` : ''
    )
  })
  if (isDev && RENDERER_URL) {
    win.loadURL(`${RENDERER_URL}/${route}.html`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${route}.html`))
  }
}

/** 仅放行安全协议的外链，用系统浏览器打开。 */
function openExternalSafe(url: string): void {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
}

/** 阻止应用窗口被链接导航走：外链交给系统浏览器，应用自身路由放行。 */
function guardNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const isAppUrl =
      url.startsWith('file://') || (RENDERER_URL ? url.startsWith(RENDERER_URL) : false)
    if (isAppUrl) return
    e.preventDefault()
    openExternalSafe(url)
  })
}

function allowMediaPermission(): void {
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      if (permission === 'media') {
        callback(true)
        return
      }
      callback(false)
    })
  } catch {
    // ignore
  }
}

export function createPetWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay()
  allowMediaPermission()
  petWindow = new BrowserWindow({
    ...PET_SIZE,
    x: workArea.x + workArea.width - PET_SIZE.width - 24,
    y: workArea.y + workArea.height - PET_SIZE.height - 24,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 宠边常被遮挡/失焦；关掉节流，避免定时器与流式 UI 被拖到 1fps
      backgroundThrottling: false
    }
  })
  petWindow.setAlwaysOnTop(true, 'floating')
  petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  petWindow.webContents.setBackgroundThrottling(false)
  // 默认可交互（安全兜底：万一渲染层未接管也不会导致宠物点不动）；
  // 渲染层会在鼠标移出宠物本体时开启点击穿透（见 setPetIgnoreMouse）。
  loadRoute(petWindow, 'pet')
  guardNavigation(petWindow)
  petWindow.on('closed', () => {
    clearDockWatch()
    dockEdge = null
    dockExpanded = false
    petWindow = null
  })
  return petWindow
}

/**
 * 露出宠物。默认不抢键盘焦点——气泡/审批弹出不得打断用户在 IDE、对话里打字。
 * 只有托盘、热键、用户点宠物时才 focus。
 */
export function showPet(opts?: { focus?: boolean }): void {
  if (!petWindow || petWindow.isDestroyed()) return
  if (opts?.focus) {
    petWindow.show()
    petWindow.focus()
    return
  }
  // 已经在桌面上：再 show/showInactive 仍可能把系统焦点从输入法/IDE 拽走
  if (petWindow.isVisible()) return
  if (typeof petWindow.showInactive === 'function') petWindow.showInactive()
  else petWindow.show()
}

/** 宠物窗口透明区域点击穿透开关（true=穿透到桌面，false=接管交互）。 */
export function setPetIgnoreMouse(ignore: boolean): void {
  petWindow?.setIgnoreMouseEvents(ignore, { forward: true })
}

/** 快问垫高；待办再加宽，审批卡不再挤在 272px。 */
export function setPetQuickChatExpanded(expanded: boolean, wide = false): void {
  if (!petWindow || petWindow.isDestroyed()) return
  const b = petWindow.getBounds()
  const targetH = PET_SIZE.height + (expanded ? PET_QUICK_CHAT_EXTRA_H : 0)
  const targetW = PET_SIZE.width + (expanded && wide ? PET_ATTN_EXTRA_W : 0)
  if (b.height === targetH && b.width === targetW) return
  const dy = targetH - b.height
  const dx = targetW - (b.width || PET_SIZE.width)
  const { workArea } = screen.getDisplayMatching(b)
  let x = b.x - dx
  let y = b.y - dy
  if (x < workArea.x) x = workArea.x
  if (x + targetW > workArea.x + workArea.width) {
    x = workArea.x + workArea.width - targetW
  }
  if (y < workArea.y) y = workArea.y
  petWindow.setBounds({ x, y, width: targetW, height: targetH })
}

function clampWindowToWorkArea(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const b = win.getBounds()
  const { workArea } = screen.getDisplayMatching(b)
  const width = Math.min(Math.max(b.width, win.getMinimumSize()[0] || 0), workArea.width)
  const height = Math.min(Math.max(b.height, win.getMinimumSize()[1] || 0), workArea.height)
  const x = Math.min(Math.max(b.x, workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(b.y, workArea.y), workArea.y + workArea.height - height)
  if (x !== b.x || y !== b.y || width !== b.width || height !== b.height) {
    win.setBounds({ x, y, width, height })
  }
}

function ensureChatWindowChrome(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  try {
    win.setWindowButtonVisibility(true)
    // Electron 33 类型未暴露 setTrafficLightPosition；构造时已设 trafficLightPosition
    const reposition = (
      win as BrowserWindow & {
        setTrafficLightPosition?: (pos: { x: number; y: number }) => void
      }
    ).setTrafficLightPosition
    reposition?.call(win, { x: 14, y: 12 })
  } catch {
    // older Electron / non-mac
  }
  clampWindowToWorkArea(win)
}

export function createChatWindow(): BrowserWindow {
  chatWindow = new BrowserWindow({
    ...CHAT_SIZE,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    minWidth: 560,
    minHeight: 480,
    // 对话窗按普通窗口处理，不抢其它应用焦点层；宠物仍始终置顶
    alwaysOnTop: false,
    skipTaskbar: false,
    backgroundColor: '#f6efe0',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // RSS 中间栏用 <webview> 读原文（沙箱分区，非通用浏览器壳）
      webviewTag: true
    }
  })
  loadRoute(chatWindow, 'chat')
  guardNavigation(chatWindow)
  chatWindow.webContents.on('did-finish-load', () => {
    if (!chatWindow || chatWindow.isDestroyed()) return
    chatLastFinishLoadAt = Date.now()
    scheduleChatBootHeal(chatWindow)
  })
  chatWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[window:chat] render-process-gone', details)
    if (!chatWindow || chatWindow.isDestroyed()) return
    if (details.reason === 'clean-exit') return
    // 渲染进程崩了会只剩半截 UI（常见表现为顶栏消失），自动重载拉回完整壳层
    chatBootReloadAttempts = 0
    chatWindow.webContents.reload()
  })
  chatWindow.on('show', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      ensureChatWindowChrome(chatWindow)
      void healChatIfBlank(chatWindow, 'show')
    }
    notifyChatVisibility(true)
  })
  chatWindow.on('hide', () => notifyChatVisibility(false))
  // 关红灯 / ⌘W：隐藏而不是销毁，切换模型后快问仍能代发
  chatWindow.on('close', (e) => {
    if (appQuitting) return
    e.preventDefault()
    chatWindow?.hide()
  })
  chatWindow.on('closed', () => {
    chatWindow = null
    notifyChatVisibility(false)
    onChatWindowClosed?.()
  })
  // 延迟加载，避免与 hotkey↔windows 循环依赖
  void import('./quickChatHotkey').then((m) => {
    if (chatWindow && !chatWindow.isDestroyed()) m.wireQuickChatHotkeyToChatWindow(chatWindow)
  })
  return chatWindow
}

/** 快问代发用：没有对话窗就建一个（保持隐藏亦可）。 */
export function ensureChatWindow(): BrowserWindow {
  if (chatWindow && !chatWindow.isDestroyed()) return chatWindow
  return createChatWindow()
}

/** 告诉宠物：对话窗开了就收快问，关了才允许再弹。 */
function notifyChatVisibility(visible: boolean): void {
  if (!petWindow || petWindow.isDestroyed()) return
  petWindow.webContents.send(IPC.chatVisibility, visible)
}

/** 把聊天窗停靠在宠物旁边（优先左侧，空间不够则放右侧）。 */
function anchorChatToPet(): void {
  if (!chatWindow || !petWindow) return
  const petBounds = petWindow.getBounds()
  const chatBounds = chatWindow.getBounds()
  const { workArea } = screen.getDisplayMatching(petBounds)

  let x = petBounds.x - chatBounds.width - 12
  if (x < workArea.x) x = petBounds.x + petBounds.width + 12
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - chatBounds.width))

  let y = petBounds.y + petBounds.height - chatBounds.height
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - chatBounds.height))

  chatWindow.setPosition(Math.round(x), Math.round(y))
}

export function toggleChat(): void {
  if (!chatWindow) createChatWindow()
  if (!chatWindow) return
  if (chatWindow.isVisible()) {
    chatWindow.hide()
  } else {
    openChat()
  }
}

export function openChat(): void {
  if (!chatWindow) createChatWindow()
  if (!chatWindow) return
  if (dockEdge && !dockExpanded) expandPetDock()
  anchorChatToPet()
  ensureChatWindowChrome(chatWindow)
  chatWindow.show()
  if (process.platform === 'darwin') {
    app.focus({ steal: true })
  }
  chatWindow.moveTop()
  chatWindow.focus()
  // Vite 重启后旧窗常卡在空 #root；打开时再探一次
  void healChatIfBlank(chatWindow, 'openChat')
}

/** 皮肤窗：贴宠物旁打开，下载选用后立刻反映到宠物。 */
export function createSkinsWindow(): BrowserWindow {
  skinsWindow = new BrowserWindow({
    ...SKINS_SIZE,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    minWidth: 360,
    minHeight: 480,
    alwaysOnTop: false,
    skipTaskbar: false,
    backgroundColor: '#f6efe0',
    titleBarStyle: 'hiddenInset',
    title: '皮肤',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // 避免原生标题与自定义顶栏叠字
  skinsWindow.setTitle('皮肤')
  loadRoute(skinsWindow, 'skins')
  guardNavigation(skinsWindow)
  skinsWindow.on('closed', () => {
    skinsWindow = null
  })
  return skinsWindow
}

/** 把皮肤窗停靠在宠物旁边（优先右侧，空间不够则放左侧）。 */
function anchorSkinsToPet(): void {
  if (!skinsWindow || !petWindow) return
  const petBounds = petWindow.getBounds()
  const skinsBounds = skinsWindow.getBounds()
  const { workArea } = screen.getDisplayMatching(petBounds)

  let x = petBounds.x + petBounds.width + 12
  if (x + skinsBounds.width > workArea.x + workArea.width) {
    x = petBounds.x - skinsBounds.width - 12
  }
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - skinsBounds.width))

  let y = petBounds.y + petBounds.height - skinsBounds.height
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - skinsBounds.height))

  skinsWindow.setPosition(Math.round(x), Math.round(y))
}

export function openSkins(): void {
  if (!skinsWindow) createSkinsWindow()
  if (!skinsWindow) return
  if (dockEdge && !dockExpanded) expandPetDock()
  anchorSkinsToPet()
  skinsWindow.show()
  skinsWindow.focus()
}

export function closeSkins(): void {
  skinsWindow?.hide()
}

export function toggleSkins(): void {
  if (!skinsWindow) createSkinsWindow()
  if (!skinsWindow) return
  if (skinsWindow.isVisible()) {
    skinsWindow.hide()
  } else {
    openSkins()
  }
}

export function getPetWindow(): BrowserWindow | null {
  return petWindow
}

export function getChatWindow(): BrowserWindow | null {
  return chatWindow
}

export function getSkinsWindow(): BrowserWindow | null {
  return skinsWindow
}

// ---------- 宠物窗口拖拽 + 贴边半隐藏 ----------

function workAreaForPet(): Electron.Rectangle {
  if (!petWindow) return screen.getPrimaryDisplay().workArea
  return screen.getDisplayMatching(petWindow.getBounds()).workArea
}

function clampPetPosition(x: number, y: number): { x: number; y: number } {
  const { workArea } = screen.getDisplayNearestPoint({
    x: Math.round(x + PET_SIZE.width / 2),
    y: Math.round(y + PET_SIZE.height / 2)
  })
  const minX = workArea.x - PET_DRAG_EDGE_SLACK
  const maxX = workArea.x + workArea.width - PET_SIZE.width + PET_DRAG_EDGE_SLACK
  const minY = workArea.y - PET_DRAG_TOP_SLACK
  const maxY = workArea.y + workArea.height - Math.round(PET_SIZE.height * 0.4)
  return {
    x: Math.round(Math.max(minX, Math.min(maxX, x))),
    y: Math.round(Math.max(minY, Math.min(maxY, y)))
  }
}

function clampDockY(y: number, wa: Electron.Rectangle): number {
  const minY = wa.y - 8
  const maxY = wa.y + wa.height - Math.round(PET_SIZE.height * 0.45)
  return Math.round(Math.max(minY, Math.min(maxY, y)))
}

function notifyPetDockVisual(): void {
  const visual: PetDockEdge = dockEdge && !dockExpanded ? dockEdge : null
  petWindow?.webContents.send(IPC.petDockEdge, visual)
}

function applyDockPosition(): void {
  if (!petWindow || !dockEdge) return
  const b = petWindow.getBounds()
  const wa = workAreaForPet()
  let x = b.x
  let y = b.y
  if (dockEdge === 'left') {
    x = dockExpanded ? wa.x + PET_DOCK_EXPAND_GAP : wa.x - PET_SIZE.width + PET_DOCK_PEEK
  } else {
    x = dockExpanded
      ? wa.x + wa.width - PET_SIZE.width - PET_DOCK_EXPAND_GAP
      : wa.x + wa.width - PET_DOCK_PEEK
  }
  y = clampDockY(y, wa)
  petWindow.setPosition(Math.round(x), Math.round(y))
}

function clearDockWatch(): void {
  if (dockWatch) {
    clearInterval(dockWatch)
    dockWatch = null
  }
  if (dockCollapseTimer) {
    clearTimeout(dockCollapseTimer)
    dockCollapseTimer = null
  }
}

function clearPetDock(): void {
  clearDockWatch()
  dockEdge = null
  dockExpanded = false
  notifyPetDockVisual()
}

function expandPetDock(): void {
  if (!dockEdge || dockExpanded) return
  if (dockCollapseTimer) {
    clearTimeout(dockCollapseTimer)
    dockCollapseTimer = null
  }
  dockExpanded = true
  applyDockPosition()
  notifyPetDockVisual()
}

function collapsePetDock(): void {
  if (!dockEdge || !dockExpanded) return
  dockExpanded = false
  dockExpandArmedAt = Date.now() + DOCK_EXPAND_COOLDOWN_MS
  applyDockPosition()
  notifyPetDockVisual()
}

function scheduleCollapsePetDock(): void {
  if (!dockEdge || !dockExpanded || dockCollapseTimer) return
  dockCollapseTimer = setTimeout(() => {
    dockCollapseTimer = null
    // 定时器触发时再确认一次：光标若又回到边缘条/窗口，则不收起
    const p = screen.getCursorScreenPoint()
    if (cursorNearPetDock(p)) return
    collapsePetDock()
  }, DOCK_COLLAPSE_MS)
}

/** 工作区边缘露出条（收起热区）；展开时也算「仍靠近」，避免跳位后误判离开。 */
function cursorInPeekStrip(p: Electron.Point, wa: Electron.Rectangle, edge: DockEdge): boolean {
  const pad = 14
  const b = petWindow?.getBounds()
  const y0 = (b?.y ?? p.y) - pad
  const y1 = (b?.y ?? p.y) + (b?.height ?? PET_SIZE.height) + pad
  if (edge === 'left') {
    return p.x >= wa.x - 2 && p.x <= wa.x + PET_DOCK_PEEK + pad && p.y >= y0 && p.y <= y1
  }
  const left = wa.x + wa.width - PET_DOCK_PEEK
  return p.x >= left - pad && p.x <= wa.x + wa.width + 2 && p.y >= y0 && p.y <= y1
}

/** 光标是否落在贴边露出条 / 展开后的窗口附近（含一点外扩）。 */
function cursorNearPetDock(p: Electron.Point): boolean {
  if (!petWindow || !dockEdge) return false
  const b = petWindow.getBounds()
  const wa = workAreaForPet()
  const pad = 12
  // 边缘条始终算靠近：展开跳位后光标仍在条上时不要立刻判离场
  if (cursorInPeekStrip(p, wa, dockEdge)) return true
  if (!dockExpanded) return false
  return (
    p.x >= b.x - pad &&
    p.x <= b.x + b.width + pad &&
    p.y >= b.y - pad &&
    p.y <= b.y + b.height + pad
  )
}

function startDockWatch(): void {
  clearDockWatch()
  if (!dockEdge) return
  dockWatch = setInterval(() => {
    if (!petWindow || !dockEdge || dragInterval) return
    const p = screen.getCursorScreenPoint()
    if (cursorNearPetDock(p)) {
      if (Date.now() < dockExpandArmedAt) return
      expandPetDock()
    } else {
      scheduleCollapsePetDock()
    }
  }, 80)
}

function setPetDock(edge: DockEdge): void {
  dockEdge = edge
  dockExpanded = false
  applyDockPosition()
  notifyPetDockVisual()
  startDockWatch()
}

function evaluatePetDockFromPosition(): void {
  if (!petWindow) return
  const b = petWindow.getBounds()
  const wa = screen.getDisplayMatching(b).workArea
  const overhangLeft = wa.x - b.x
  const overhangRight = b.x + b.width - (wa.x + wa.width)

  if (overhangLeft >= PET_DOCK_TRIGGER || b.x <= wa.x + 6) {
    setPetDock('left')
    return
  }
  if (overhangRight >= PET_DOCK_TRIGGER || b.x + b.width >= wa.x + wa.width - 6) {
    setPetDock('right')
    return
  }
  clearPetDock()
}

export function startPetDrag(): void {
  if (!petWindow || dragInterval) return
  clearDockWatch()
  // 拖动前先展开到可见位置，避免从屏外硬拽
  if (dockEdge && !dockExpanded) {
    dockExpanded = true
    applyDockPosition()
    notifyPetDockVisual()
  }
  dockEdge = null
  dockExpanded = false
  notifyPetDockVisual()

  const start = screen.getCursorScreenPoint()
  const origin = petWindow.getBounds()
  const offset = { x: start.x - origin.x, y: start.y - origin.y }
  dragInterval = setInterval(() => {
    if (!petWindow) return stopPetDrag()
    const p = screen.getCursorScreenPoint()
    const next = clampPetPosition(p.x - offset.x, p.y - offset.y)
    petWindow.setPosition(next.x, next.y)
  }, 16)
}

export function stopPetDrag(): void {
  if (dragInterval) {
    clearInterval(dragInterval)
    dragInterval = null
  }
  evaluatePetDockFromPosition()
}
