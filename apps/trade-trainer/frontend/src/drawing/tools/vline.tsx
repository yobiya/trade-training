import type { ReactNode } from 'react'
import type { Drawing } from '../../api/types'
import { getTimeframeColor } from '../../constants'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'

// 縦線の x 方向当たり判定(px)
const HIT_TOLERANCE_PX = 6

// SVG 縦線の y 端点。SVG は overflow-clip で外側を切り取るため十分大きい値で
// chart 全高を貫かせる。
const VERTICAL_EXTENT_PX = 10000

export function getVlineTime(drawing: Drawing): number | null {
  const t = Number((drawing.data as { t?: number }).t)
  return Number.isFinite(t) ? t : null
}

export const vlineTool: ToolMetadata = {
  kind: 'vline',
  label: '縦線',
  icon: '│',
  // 仕様書 §5.3: 縦線(時刻線)は全時間足表示(時刻は TF 共通)
  defaultVisibleTfs: null,

  hitTest(drawing: Drawing, px: PointPx, api: ChartApi): HitResult | null {
    const t = getVlineTime(drawing)
    if (t === null) return null
    const x = api.timeToX(t)
    if (x === null) return null
    if (Math.abs(px.x - x) > HIT_TOLERANCE_PX) return null
    return { drawingId: drawing.id, kind: 'vline', part: 'body' }
  },

  renderOverlay(drawing: Drawing, api: ChartApi): ReactNode {
    const t = getVlineTime(drawing)
    if (t === null) return null
    const x = api.timeToX(t)
    if (x === null) return null
    const isPreview = drawing.id < 0
    const color = getTimeframeColor(drawing.timeframe)
    return (
      <line
        x1={x} y1={-VERTICAL_EXTENT_PX} x2={x} y2={VERTICAL_EXTENT_PX}
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={isPreview ? '4 3' : undefined}
      />
    )
  },
}
