import { useUiLocale } from '../i18n'
import type { CSSProperties } from 'react'
import type { PetMood, PetState, SkinId } from '@shared/types'
import { SKIN_PALETTES, type EarType, type SkinFeature } from './skins'

type View = PetState | PetMood

function Ears({
  ear,
  gradId,
  color
}: {
  ear: EarType
  gradId: string
  color?: string
}): JSX.Element | null {
  useUiLocale()
  const fill = color ?? `url(#${gradId})`
  switch (ear) {
    case 'bear':
      return (
        <>
          <circle className="ear" cx="58" cy="58" r="20" fill={fill} />
          <circle className="ear" cx="142" cy="58" r="20" fill={fill} />
        </>
      )
    case 'cat':
      return (
        <>
          <path className="ear" d="M50 66 L46 30 L82 52 Z" fill={fill} />
          <path className="ear" d="M150 66 L154 30 L118 52 Z" fill={fill} />
        </>
      )
    case 'antenna':
      return (
        <>
          <line x1="100" y1="40" x2="100" y2="18" stroke="#7c7c9c" strokeWidth="3" />
          <circle cx="100" cy="14" r="6" className="antenna-tip" fill="#fde047" />
        </>
      )
    case 'capy':
      return (
        <>
          <circle className="ear" cx="70" cy="48" r="11" fill={fill} />
          <circle className="ear" cx="130" cy="48" r="11" fill={fill} />
          <circle cx="70" cy="48" r="5" fill="rgba(0,0,0,0.25)" />
          <circle cx="130" cy="48" r="5" fill="rgba(0,0,0,0.25)" />
        </>
      )
    case 'none':
    default:
      return null
  }
}

/** 画在身体「之下」的装饰（牛角等要从头顶探出）。 */
function DecorBehind({ features }: { features: SkinFeature[] }): JSX.Element | null {
  useUiLocale()
  if (!features.length) return null
  return (
    <>
      {features.includes('cowHorns') && (
        <g>
          {/* 牛耳 */}
          <ellipse cx="52" cy="70" rx="16" ry="10" fill="#f6f5ef" transform="rotate(-28 52 70)" />
          <ellipse cx="148" cy="70" rx="16" ry="10" fill="#f6f5ef" transform="rotate(28 148 70)" />
          {/* 牛角 */}
          <path d="M64 52 Q52 30 40 32 Q54 38 60 60 Z" fill="#e7d8b0" stroke="#c9b78a" strokeWidth="1.5" />
          <path d="M136 52 Q148 30 160 32 Q146 38 140 60 Z" fill="#e7d8b0" stroke="#c9b78a" strokeWidth="1.5" />
        </g>
      )}
    </>
  )
}

/** 画在身体「之上」、眼睛之下的装饰（花纹、斑点、黑眼圈）。 */
function DecorOnBody({ features }: { features: SkinFeature[] }): JSX.Element | null {
  useUiLocale()
  return (
    <>
      {features.includes('basketball') && (
        <g stroke="#5b2c0a" strokeWidth="3" fill="none" opacity="0.85" strokeLinecap="round">
          <path d="M100 33 L100 183" />
          <path d="M27 100 Q100 116 173 100" />
          <path d="M45 55 Q76 100 45 158" />
          <path d="M155 55 Q124 100 155 158" />
        </g>
      )}
      {features.includes('cowSpots') && (
        <g fill="#2b2b33">
          <path d="M58 84 Q74 74 84 90 Q80 108 62 104 Q50 96 58 84 Z" />
          <path d="M128 150 Q146 142 150 160 Q142 176 126 168 Q120 156 128 150 Z" />
          <ellipse cx="140" cy="96" rx="12" ry="9" />
          <ellipse cx="70" cy="150" rx="10" ry="8" />
        </g>
      )}
      {features.includes('kunHair') && (
        // 中分刘海
        <path
          d="M40 78 Q46 34 100 30 Q154 34 160 78 Q150 56 104 54 Q100 78 96 54 Q50 56 40 78 Z"
          fill="#171720"
        />
      )}
      {features.includes('pandaEyes') && (
        <g fill="#1f1f2b">
          <ellipse cx="78" cy="99" rx="17" ry="21" transform="rotate(-18 78 99)" />
          <ellipse cx="122" cy="99" rx="17" ry="21" transform="rotate(18 122 99)" />
        </g>
      )}
      {features.includes('frogEyes') && (
        <g className="frog-eyes">
          <circle cx="72" cy="58" r="21" fill="#eaf7d0" stroke="#4d7c0f" strokeWidth="2.5" />
          <circle cx="128" cy="58" r="21" fill="#eaf7d0" stroke="#4d7c0f" strokeWidth="2.5" />
          <circle className="pupil" cx="72" cy="60" r="8" fill="#1c2b0f" />
          <circle className="pupil" cx="128" cy="60" r="8" fill="#1c2b0f" />
          <circle cx="75" cy="56" r="2.5" fill="#fff" />
          <circle cx="131" cy="56" r="2.5" fill="#fff" />
        </g>
      )}
    </>
  )
}

/** 画在最上层的装饰（口鼻、汗滴）。 */
function DecorFront({ features }: { features: SkinFeature[] }): JSX.Element | null {
  useUiLocale()
  return (
    <>
      {features.includes('muzzle') && (
        <g>
          <ellipse cx="100" cy="138" rx="30" ry="19" fill="#f6c9d4" opacity="0.9" />
          <ellipse cx="90" cy="136" rx="3.5" ry="5" fill="#b98a97" />
          <ellipse cx="110" cy="136" rx="3.5" ry="5" fill="#b98a97" />
        </g>
      )}
      {features.includes('sweat') && (
        <path
          className="sweat-drop"
          d="M150 66 Q158 80 150 86 Q142 80 150 66 Z"
          fill="#7dd3fc"
          stroke="#38bdf8"
          strokeWidth="1"
        />
      )}
      {features.includes('shiba') && (
        <g>
          {/* 柴犬奶白口鼻 */}
          <ellipse cx="100" cy="130" rx="26" ry="18" fill="#f9ecd4" />
          <ellipse cx="100" cy="120" rx="4.5" ry="3.2" fill="#3a2a1a" />
          {/* 招牌粗眉 */}
          <path d="M66 82 Q76 78 88 82" stroke="#a9752f" strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M112 82 Q124 78 134 82" stroke="#a9752f" strokeWidth="5" strokeLinecap="round" fill="none" />
        </g>
      )}
      {features.includes('yuzu') && (
        <g>
          <ellipse cx="122" cy="42" rx="7" ry="4" fill="#4d7c0f" transform="rotate(-25 122 42)" />
          <circle cx="112" cy="48" r="13" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5" />
          <circle cx="108" cy="44" r="3" fill="#fbbf24" opacity="0.8" />
        </g>
      )}
    </>
  )
}

/** 纯 SVG 宠物形象，支持多套皮肤（含整活皮肤）+ 由 CSS class 驱动表情。 */
export function Mascot({ view, skin }: { view: View; skin: SkinId }): JSX.Element {
  useUiLocale()
  const p = SKIN_PALETTES[skin]
  const gradId = `grad-${skin}`
  const features = p.features ?? []
  const mouthStyle: 'default' | 'grin' | 'wide' | 'muzzle' =
    p.mouth ?? (features.includes('muzzle') ? 'muzzle' : 'default')
  return (
    <svg
      className="mascot"
      viewBox="0 0 200 200"
      width="140"
      height="140"
      style={{ ['--glow']: p.glow } as CSSProperties}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={gradId} cx="42%" cy="34%" r="75%">
          <stop offset="0%" stopColor={p.c1} />
          <stop offset="60%" stopColor={p.c2} />
          <stop offset="100%" stopColor={p.c3} />
        </radialGradient>
        <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.6" />
        </filter>
      </defs>

      <DecorBehind features={features} />
      <Ears ear={p.ear} gradId={gradId} color={p.earColor} />

      {/* 身体 */}
      <circle cx="100" cy="108" r="76" fill={`url(#${gradId})`} />
      <ellipse cx="100" cy="124" rx="46" ry="42" fill={p.belly} opacity="0.45" />

      <DecorOnBody features={features} />

      {/* 腮红 */}
      <circle className="cheek" cx="60" cy="120" r="9" fill={p.cheek} opacity="0.55" />
      <circle className="cheek" cx="140" cy="120" r="9" fill={p.cheek} opacity="0.55" />

      {!p.hideEyes && (
        <>
          {/* 睁眼 */}
          <g className="eyes-open">
            <g className="eye eye-left">
              <circle cx="78" cy="98" r="13" fill="#ffffff" />
              <circle className="pupil" cx="81" cy="100" r="6.5" fill="#1c1b33" />
              <circle cx="83.5" cy="97.5" r="2" fill="#ffffff" />
            </g>
            <g className="eye eye-right">
              <circle cx="122" cy="98" r="13" fill="#ffffff" />
              <circle className="pupil" cx="125" cy="100" r="6.5" fill="#1c1b33" />
              <circle cx="127.5" cy="97.5" r="2" fill="#ffffff" />
            </g>
          </g>

          {/* 闭眼 / 开心弯眼 */}
          <g className="eyes-closed">
            <path d="M68 99 Q78 91 88 99" stroke="#1c1b33" strokeWidth="3.5" fill="none" strokeLinecap="round" />
            <path d="M112 99 Q122 91 132 99" stroke="#1c1b33" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          </g>

          {/* 眩晕眼 */}
          <g className="eyes-dizzy">
            <text x="70" y="104" fontSize="20" fill="#1c1b33">×</text>
            <text x="114" y="104" fontSize="20" fill="#1c1b33">×</text>
          </g>
        </>
      )}

      <DecorFront features={features} />

      <Mouth style={mouthStyle} />
    </svg>
  )
}

function Mouth({ style }: { style: 'default' | 'grin' | 'wide' | 'muzzle' }): JSX.Element {
  useUiLocale()
  switch (style) {
    case 'grin':
      // 大笑（露齿）
      return (
        <g>
          <path d="M74 122 Q100 126 126 122 Q118 150 100 150 Q82 150 74 122 Z" fill="#7a2e33" />
          <path d="M80 124 Q100 127 120 124 L118 131 Q100 133 82 131 Z" fill="#ffffff" />
        </g>
      )
    case 'wide':
      // 青蛙大扁嘴
      return (
        <path
          d="M56 134 Q100 156 144 134"
          stroke="#2f4d0a"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      )
    case 'muzzle':
      return (
        <path
          className="mouth"
          d="M90 142 Q100 150 110 142"
          stroke="#a06274"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
        />
      )
    default:
      return (
        <path
          className="mouth"
          d="M88 128 Q100 138 112 128"
          stroke="#3b246e"
          strokeWidth="3.5"
          strokeLinecap="round"
          fill="none"
          filter="url(#soft)"
        />
      )
  }
}
