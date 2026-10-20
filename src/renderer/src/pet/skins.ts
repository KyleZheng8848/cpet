import type { SkinId } from '@shared/types'

export type EarType = 'bear' | 'cat' | 'none' | 'antenna' | 'capy'

/** 皮肤专属装饰特征。 */
export type SkinFeature =
  | 'pandaEyes' // 熊猫黑眼圈
  | 'cowHorns' // 牛角 + 牛耳
  | 'cowSpots' // 奶牛斑点
  | 'muzzle' // 牛/马口鼻
  | 'sweat' // 汗滴（打工人）
  | 'basketball' // 篮球纹路
  | 'kunHair' // 中分刘海
  | 'shiba' // 柴犬眉毛 + 口鼻
  | 'yuzu' // 卡皮巴拉头顶柚子
  | 'frogEyes' // 青蛙顶部大眼
  | 'grin' // 黄脸大笑
  | 'wideMouth' // 青蛙大扁嘴

/** 嘴型：默认 / 大笑 / 大扁嘴 / 牛口鼻。 */
export type MouthStyle = 'default' | 'grin' | 'wide' | 'muzzle'

export interface SkinPalette {
  /** 渐变三段色（浅→主→深）。 */
  c1: string
  c2: string
  c3: string
  belly: string
  cheek: string
  ear: EarType
  /** 覆盖耳朵颜色（如熊猫黑耳）。 */
  earColor?: string
  /** drop-shadow 颜色。 */
  glow: string
  /** 额外装饰。 */
  features?: SkinFeature[]
  /** 隐藏默认眼睛（由 feature 自带眼睛，如青蛙）。 */
  hideEyes?: boolean
  /** 嘴型。 */
  mouth?: MouthStyle
}

export const SKIN_PALETTES: Record<SkinId, SkinPalette> = {
  violet: {
    c1: '#a78bfa',
    c2: '#7c5cff',
    c3: '#6d4bf0',
    belly: '#b9a6ff',
    cheek: '#ff8fb1',
    ear: 'bear',
    glow: 'rgba(90, 60, 200, 0.35)'
  },
  mint: {
    c1: '#6ee7b7',
    c2: '#34d399',
    c3: '#10b981',
    belly: '#bbf7d8',
    cheek: '#fca5a5',
    ear: 'cat',
    glow: 'rgba(16, 185, 129, 0.35)'
  },
  peach: {
    c1: '#fed7aa',
    c2: '#fb923c',
    c3: '#f97316',
    belly: '#ffe4c4',
    cheek: '#fb7185',
    ear: 'none',
    glow: 'rgba(249, 115, 22, 0.35)'
  },
  slate: {
    c1: '#93c5fd',
    c2: '#3b82f6',
    c3: '#2563eb',
    belly: '#c7ddff',
    cheek: '#f0abfc',
    ear: 'antenna',
    glow: 'rgba(37, 99, 235, 0.4)'
  },
  // 🐼 熊猫
  panda: {
    c1: '#ffffff',
    c2: '#f1f1f5',
    c3: '#dededd',
    belly: '#ffffff',
    cheek: '#ffc2d1',
    ear: 'bear',
    earColor: '#1f1f2b',
    glow: 'rgba(40, 40, 60, 0.3)',
    features: ['pandaEyes']
  },
  // 🐮 牛马（打工人）
  cow: {
    c1: '#ffffff',
    c2: '#f6f5ef',
    c3: '#e6e5db',
    belly: '#fbfaf3',
    cheek: '#f9a8c4',
    ear: 'none',
    glow: 'rgba(60, 55, 45, 0.3)',
    features: ['cowHorns', 'cowSpots', 'muzzle', 'sweat']
  },
  // 🏀 坤坤（篮球）
  kun: {
    c1: '#fdba74',
    c2: '#f97316',
    c3: '#ea580c',
    belly: '#fb8c3c',
    cheek: 'rgba(0,0,0,0)',
    ear: 'none',
    glow: 'rgba(234, 88, 12, 0.4)',
    features: ['basketball', 'kunHair']
  },
  // 🐕 柴犬 doge
  doge: {
    c1: '#f2cd94',
    c2: '#e0a961',
    c3: '#c6883f',
    belly: '#f8e6c6',
    cheek: '#f6b98f',
    ear: 'cat',
    glow: 'rgba(198, 136, 63, 0.4)',
    features: ['shiba']
  },
  // 🦫 卡皮巴拉
  capy: {
    c1: '#b99a78',
    c2: '#93745a',
    c3: '#705642',
    belly: '#cbb59c',
    cheek: 'rgba(0,0,0,0)',
    ear: 'capy',
    glow: 'rgba(112, 86, 66, 0.4)',
    features: ['yuzu']
  },
  // 🐸 青蛙
  frog: {
    c1: '#a3e635',
    c2: '#65a30d',
    c3: '#4d7c0f',
    belly: '#d9f99d',
    cheek: '#fca5a5',
    ear: 'none',
    glow: 'rgba(101, 163, 13, 0.4)',
    features: ['frogEyes'],
    hideEyes: true,
    mouth: 'wide'
  },
  // 😄 黄脸 emoji
  emoji: {
    c1: '#ffe066',
    c2: '#ffcc33',
    c3: '#f0b400',
    belly: '#ffe680',
    cheek: '#ff9e9e',
    ear: 'none',
    glow: 'rgba(240, 180, 0, 0.42)',
    mouth: 'grin'
  }
}
