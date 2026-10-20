/**
 * 离线验证贴边展开/收起是否震荡（不启动 Electron GUI）。
 * 复现场景：贴右边收起后，光标仍停在露出条上。
 */
const PET = { width: 280, height: 300 }
const PEEK = 72
const EXPAND_GAP = 10
const COLLAPSE_MS = 900
const EXPAND_COOLDOWN_MS = 450
const TICK = 80

const wa = { x: 0, y: 0, width: 1440, height: 900 }

function pos(expanded, edge = 'right') {
  if (edge === 'right') {
    return {
      x: expanded ? wa.x + wa.width - PET.width - EXPAND_GAP : wa.x + wa.width - PEEK,
      y: 400,
      width: PET.width,
      height: PET.height
    }
  }
  if (edge === 'left') {
    return {
      x: expanded ? wa.x + EXPAND_GAP : wa.x - PET.width + PEEK,
      y: 400,
      width: PET.width,
      height: PET.height
    }
  }
  return {
    x: 600,
    y: expanded ? wa.y + EXPAND_GAP : wa.y - PET.height + PEEK,
    width: PET.width,
    height: PET.height
  }
}

function inPeek(p, b, edge) {
  const pad = 14
  const y0 = b.y - pad
  const y1 = b.y + b.height + pad
  const x0 = b.x - pad
  const x1 = b.x + b.width + pad
  if (edge === 'left') {
    return p.x >= wa.x - 2 && p.x <= wa.x + PEEK + pad && p.y >= y0 && p.y <= y1
  }
  if (edge === 'right') {
    const left = wa.x + wa.width - PEEK
    return p.x >= left - pad && p.x <= wa.x + wa.width + 2 && p.y >= y0 && p.y <= y1
  }
  return p.y >= wa.y - 2 && p.y <= wa.y + PEEK + pad && p.x >= x0 && p.x <= x1
}

/** 旧逻辑：收起只看露出条；展开只看窗口 bounds（跳位后易判离场）。 */
function nearOld(p, b, expanded, edge) {
  const pad = 10
  if (expanded) {
    return (
      p.x >= b.x - pad &&
      p.x <= b.x + b.width + pad &&
      p.y >= b.y - pad &&
      p.y <= b.y + b.height + pad
    )
  }
  return inPeek(p, b, edge)
}

/** 新逻辑：露出条始终算靠近 + 展开冷却。 */
function nearNew(p, b, expanded, edge) {
  const pad = 12
  if (inPeek(p, b, edge)) return true
  if (!expanded) return false
  return (
    p.x >= b.x - pad &&
    p.x <= b.x + b.width + pad &&
    p.y >= b.y - pad &&
    p.y <= b.y + b.height + pad
  )
}

function simulate({
  label,
  nearFn,
  useCooldown,
  cursorAt,
  edge = 'right',
  ms = 5000,
  startExpanded = false
}) {
  let expanded = startExpanded
  let b = pos(expanded, edge)
  let collapseAt = null
  let expandArmedAt = 0
  let flips = 0
  let last = expanded

  for (let t = 0; t <= ms; t += TICK) {
    const cursor = typeof cursorAt === 'function' ? cursorAt(t, expanded, b) : cursorAt
    const n = nearFn(cursor, b, expanded, edge)
    if (n) {
      collapseAt = null
      if (!expanded && !(useCooldown && t < expandArmedAt)) {
        expanded = true
        b = pos(true, edge)
      }
    } else if (expanded) {
      if (collapseAt == null) collapseAt = t + COLLAPSE_MS
      if (t >= collapseAt) {
        const stillNear = nearFn(cursor, b, expanded, edge)
        if (!stillNear) {
          expanded = false
          b = pos(false, edge)
          if (useCooldown) expandArmedAt = t + EXPAND_COOLDOWN_MS
          collapseAt = null
        } else {
          collapseAt = null
        }
      }
    }
    if (expanded !== last) {
      flips++
      last = expanded
    }
  }
  return { label, flips, expanded }
}

// 旧逻辑震荡点：刚好在展开窗 pad 外、但仍在露出条内
const cursorOscillate = { x: wa.width + 1, y: 520 }
const cursorOnPeek = { x: wa.width - 20, y: 520 }
const cursorOnExpanded = { x: wa.width - 150, y: 520 }
const cursorAway = { x: 700, y: 520 }

const cases = [
  {
    ...simulate({
      label: 'OLD · 光标在震荡带（pad外/peek内）',
      nearFn: nearOld,
      useCooldown: false,
      cursorAt: cursorOscillate
    }),
    expect: (c) => c.flips > 4
  },
  {
    ...simulate({
      label: 'NEW · 光标在震荡带',
      nearFn: nearNew,
      useCooldown: true,
      cursorAt: cursorOscillate
    }),
    expect: (c) => c.flips <= 2 && c.expanded === true
  },
  {
    ...simulate({
      label: 'NEW · 光标停在露出条',
      nearFn: nearNew,
      useCooldown: true,
      cursorAt: cursorOnPeek
    }),
    expect: (c) => c.flips <= 2 && c.expanded === true
  },
  {
    ...simulate({
      label: 'NEW · 悬停在展开窗内',
      nearFn: nearNew,
      useCooldown: true,
      cursorAt: cursorOnExpanded,
      startExpanded: true
    }),
    expect: (c) => c.flips === 0 && c.expanded === true
  },
  {
    ...simulate({
      label: 'NEW · 离开后应收起',
      nearFn: nearNew,
      useCooldown: true,
      cursorAt: cursorAway,
      startExpanded: true
    }),
    expect: (c) => c.flips === 1 && c.expanded === false
  },
  {
    ...simulate({
      label: 'NEW · 左边缘露出条',
      nearFn: nearNew,
      useCooldown: true,
      cursorAt: { x: 20, y: 520 },
      edge: 'left'
    }),
    expect: (c) => c.flips <= 2 && c.expanded === true
  }
]

let failed = false
for (const c of cases) {
  const ok = c.expect(c)
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.label}: flips=${c.flips} expanded=${c.expanded}`)
}

if (failed) {
  console.error('\nverify-dock-hysteresis: FAILED')
  process.exit(1)
}
console.log('\nverify-dock-hysteresis: OK（新逻辑在露出条/窗内稳定，离开后会收起；旧逻辑会震荡）')
