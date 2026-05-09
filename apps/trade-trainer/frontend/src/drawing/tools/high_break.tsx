import type { ReactNode } from 'react'
import type { Drawing } from '../../api/types'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'
import { detectBreak } from './break_common'

const HIT_TOLERANCE_PX = 6
const COLOR_PENDING = '#888888'
const COLOR_BROKEN = '#26a69a'

export type HighBreakData = { t: number; price: number }

export function getHighBreakData(d: Drawing): HighBreakData | null {
  const t = Number((d.data as { t?: number }).t)
  const price = Number((d.data as { price?: number }).price)
  if (!Number.isFinite(t) || !Number.isFinite(price)) return null
  return { t, price }
}

/**
 * 線の終端時刻を導出する。
 *  - ブレイク確定: ブレイクバーの t
 *  - 未ブレイク + bars あり: 最終 bar の t(= 現在 current_position 相当)
 *  - bars 空: 選択時刻にフォールバック(視覚上ゼロ長線、実質非表示)
 */
function lineEndT(api: ChartApi, data: HighBreakData): number {
  const bars = api.getBars()
  const breakIdx = detectBreak(bars, data.t, data.price, 'above')
  if (breakIdx >= 0) return bars[breakIdx].t
  if (bars.length > 0) return bars[bars.length - 1].t
  return data.t
}

export const highBreakTool: ToolMetadata = {
  kind: 'high_break',
  label: '高値ブレイク',
  icon: '▲',
  // 仕様書 §5.3: 高値は TF 依存(同時刻でも H1 高値 ≠ M5 高値)のため作成 TF のみ表示。
  // visibility.ts のフォールスルー(timeframe === tf)に任せるため null を保持する。
  defaultVisibleTfs: null,

  hitTest(d: Drawing, px: PointPx, api: ChartApi): HitResult | null {
    const data = getHighBreakData(d)
    if (!data) return null
    const y = api.priceToY(data.price)
    const x1 = api.timeToX(data.t)
    if (y === null || x1 === null) return null
    if (Math.abs(px.y - y) > HIT_TOLERANCE_PX) return null
    const x2 = api.timeToX(lineEndT(api, data))
    if (x2 === null) return null
    if (px.x < x1 - 2 || px.x > x2 + 2) return null
    return { drawingId: d.id, kind: 'high_break', part: 'body' }
  },

  renderOverlay(d: Drawing, api: ChartApi): ReactNode {
    const data = getHighBreakData(d)
    if (!data) return null
    const y = api.priceToY(data.price)
    const x1 = api.timeToX(data.t)
    if (y === null || x1 === null) return null
    const bars = api.getBars()
    const breakIdx = detectBreak(bars, data.t, data.price, 'above')
    const endT = breakIdx >= 0
      ? bars[breakIdx].t
      : (bars.length > 0 ? bars[bars.length - 1].t : data.t)
    const x2 = api.timeToX(endT)
    if (x2 === null) return null
    const broken = breakIdx >= 0
    const color = broken ? COLOR_BROKEN : COLOR_PENDING
    const isPreview = d.id < 0
    return (
      <line
        x1={x1} y1={y} x2={x2} y2={y}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={isPreview ? '4 3' : undefined}
      />
    )
  },
}
