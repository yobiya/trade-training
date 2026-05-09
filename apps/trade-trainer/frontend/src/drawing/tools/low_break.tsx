import type { ReactNode } from 'react'
import type { Drawing } from '../../api/types'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'
import { detectBreak } from './break_common'

const HIT_TOLERANCE_PX = 6
const COLOR_PENDING = '#888888'
const COLOR_BROKEN = '#ef5350'

export type LowBreakData = { t: number; price: number }

export function getLowBreakData(d: Drawing): LowBreakData | null {
  const t = Number((d.data as { t?: number }).t)
  const price = Number((d.data as { price?: number }).price)
  if (!Number.isFinite(t) || !Number.isFinite(price)) return null
  return { t, price }
}

function lineEndT(api: ChartApi, data: LowBreakData): number {
  const bars = api.getBars()
  const breakIdx = detectBreak(bars, data.t, data.price, 'below')
  if (breakIdx >= 0) return bars[breakIdx].t
  if (bars.length > 0) return bars[bars.length - 1].t
  return data.t
}

export const lowBreakTool: ToolMetadata = {
  kind: 'low_break',
  label: '安値ブレイク',
  icon: '▼',
  // 仕様書 §5.3: 安値は TF 依存のため作成 TF のみ表示。
  defaultVisibleTfs: null,

  hitTest(d: Drawing, px: PointPx, api: ChartApi): HitResult | null {
    const data = getLowBreakData(d)
    if (!data) return null
    const y = api.priceToY(data.price)
    const x1 = api.timeToX(data.t)
    if (y === null || x1 === null) return null
    if (Math.abs(px.y - y) > HIT_TOLERANCE_PX) return null
    const x2 = api.timeToX(lineEndT(api, data))
    if (x2 === null) return null
    if (px.x < x1 - 2 || px.x > x2 + 2) return null
    return { drawingId: d.id, kind: 'low_break', part: 'body' }
  },

  renderOverlay(d: Drawing, api: ChartApi): ReactNode {
    const data = getLowBreakData(d)
    if (!data) return null
    const y = api.priceToY(data.price)
    const x1 = api.timeToX(data.t)
    if (y === null || x1 === null) return null
    const bars = api.getBars()
    const breakIdx = detectBreak(bars, data.t, data.price, 'below')
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
