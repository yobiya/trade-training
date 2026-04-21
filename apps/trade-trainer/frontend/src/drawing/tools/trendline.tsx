import type { ReactNode } from 'react'
import type { Drawing } from '../../api/types'
import { getTimeframeColor } from '../../constants'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'

// 線(または端点)の当たり判定範囲(px)
const LINE_HIT_TOLERANCE_PX = 6
const HANDLE_HIT_TOLERANCE_PX = 8

export type TrendlinePoint = { t: number; price: number }

export function getTrendlinePoints(drawing: Drawing): TrendlinePoint[] | null {
  const pts = drawing.data.points as unknown
  if (!Array.isArray(pts) || pts.length !== 2) return null
  return pts.map(p => ({ t: Number((p as TrendlinePoint).t), price: Number((p as TrendlinePoint).price) }))
}

function pointToPx(p: TrendlinePoint, api: ChartApi): { x: number; y: number } | null {
  const x = api.timeToX(p.t)
  const y = api.priceToY(p.price)
  if (x === null || y === null) return null
  return { x, y }
}

/** 点 P から線分 AB までの最短距離(px)。 */
function distanceFromSegment(px: PointPx, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px.x - a.x, px.y - a.y)
  let t = ((px.x - a.x) * dx + (px.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const fx = a.x + t * dx
  const fy = a.y + t * dy
  return Math.hypot(px.x - fx, px.y - fy)
}

export const trendlineTool: ToolMetadata = {
  kind: 'trendline',
  label: 'トレンドライン',
  icon: '╱',
  // 仕様書 §5.3: トレンドラインは全時間足表示
  defaultVisibleTfs: null,

  hitTest(drawing: Drawing, pointer: PointPx, api: ChartApi): HitResult | null {
    const pts = getTrendlinePoints(drawing)
    if (!pts) return null
    const a = pointToPx(pts[0], api)
    const b = pointToPx(pts[1], api)
    if (!a || !b) return null

    // 端点判定を先に。端点付近は body よりも handle として扱う。
    if (Math.hypot(pointer.x - a.x, pointer.y - a.y) < HANDLE_HIT_TOLERANCE_PX) {
      return { drawingId: drawing.id, kind: 'trendline', part: 'handle', handleIndex: 0 }
    }
    if (Math.hypot(pointer.x - b.x, pointer.y - b.y) < HANDLE_HIT_TOLERANCE_PX) {
      return { drawingId: drawing.id, kind: 'trendline', part: 'handle', handleIndex: 1 }
    }
    if (distanceFromSegment(pointer, a, b) < LINE_HIT_TOLERANCE_PX) {
      return { drawingId: drawing.id, kind: 'trendline', part: 'body' }
    }
    return null
  },

  renderOverlay(drawing: Drawing, api: ChartApi): ReactNode {
    const pts = getTrendlinePoints(drawing)
    if (!pts) return null
    const a = pointToPx(pts[0], api)
    const b = pointToPx(pts[1], api)
    if (!a || !b) return null
    const isPreview = drawing.id < 0
    const color = getTimeframeColor(drawing.timeframe)
    return (
      <g>
        <line
          x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={isPreview ? '4 3' : undefined}
        />
        <circle cx={a.x} cy={a.y} r={3} fill={color} />
        <circle cx={b.x} cy={b.y} r={3} fill={color} />
      </g>
    )
  },
}
