import type { ReactNode } from 'react'
import type { Drawing } from '../../api/types'
import { getTimeframeColor } from '../../constants'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'

const LINE_HIT_TOLERANCE_PX = 6
const HANDLE_HIT_TOLERANCE_PX = 8

export type ChannelPoint = { t: number; price: number }

/**
 * チャネル(平行線)の点列を取り出す。
 * - 2 点: 描画作成 phase 1 のプレビュー(基準線のみ)
 * - 3 点: 確定状態 / phase 2 プレビュー(基準線 + p3 を通る平行線)
 */
export function getChannelPoints(drawing: Drawing): ChannelPoint[] | null {
  const pts = drawing.data.points as unknown
  if (!Array.isArray(pts) || pts.length < 2 || pts.length > 3) return null
  const out = pts.map(p => ({
    t: Number((p as ChannelPoint).t),
    price: Number((p as ChannelPoint).price),
  }))
  if (out.some(p => !Number.isFinite(p.t) || !Number.isFinite(p.price))) return null
  return out
}

/** 基準線 p1-p2 を p3 で平行移動したときの価格オフセット。垂直(p1.t == p2.t)は null。 */
function offsetThrough(p1: ChannelPoint, p2: ChannelPoint, p3: ChannelPoint): number | null {
  const dt = p2.t - p1.t
  if (dt === 0) return null
  const slope = (p2.price - p1.price) / dt
  return p3.price - (p1.price + slope * (p3.t - p1.t))
}

function pointToPx(p: ChannelPoint, api: ChartApi): { x: number; y: number } | null {
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

export const channelTool: ToolMetadata = {
  kind: 'channel',
  label: 'チャネル',
  icon: '╱╱',
  // §5.3: 全時間足表示(trendline と同じ扱い、平行線は時間軸上の関係を保ったまま全 TF で意味を持つ)
  defaultVisibleTfs: null,

  hitTest(drawing: Drawing, pointer: PointPx, api: ChartApi): HitResult | null {
    const pts = getChannelPoints(drawing)
    if (!pts || pts.length !== 3) return null
    const a = pointToPx(pts[0], api)
    const b = pointToPx(pts[1], api)
    const c = pointToPx(pts[2], api)
    if (!a || !b || !c) return null

    if (Math.hypot(pointer.x - a.x, pointer.y - a.y) < HANDLE_HIT_TOLERANCE_PX) {
      return { drawingId: drawing.id, kind: 'channel', part: 'handle', handleIndex: 0 }
    }
    if (Math.hypot(pointer.x - b.x, pointer.y - b.y) < HANDLE_HIT_TOLERANCE_PX) {
      return { drawingId: drawing.id, kind: 'channel', part: 'handle', handleIndex: 1 }
    }
    if (Math.hypot(pointer.x - c.x, pointer.y - c.y) < HANDLE_HIT_TOLERANCE_PX) {
      return { drawingId: drawing.id, kind: 'channel', part: 'handle', handleIndex: 2 }
    }

    // 平行線(p3 を通る、p1-p2 と同じ slope) の端点を計算
    const offset = offsetThrough(pts[0], pts[1], pts[2])
    if (offset === null) {
      // 垂直の degenerate ケース。基準線のみで判定
      if (distanceFromSegment(pointer, a, b) < LINE_HIT_TOLERANCE_PX) {
        return { drawingId: drawing.id, kind: 'channel', part: 'body' }
      }
      return null
    }
    const a2 = pointToPx({ t: pts[0].t, price: pts[0].price + offset }, api)
    const b2 = pointToPx({ t: pts[1].t, price: pts[1].price + offset }, api)
    if (!a2 || !b2) return null

    if (
      distanceFromSegment(pointer, a, b) < LINE_HIT_TOLERANCE_PX ||
      distanceFromSegment(pointer, a2, b2) < LINE_HIT_TOLERANCE_PX
    ) {
      return { drawingId: drawing.id, kind: 'channel', part: 'body' }
    }
    return null
  },

  renderOverlay(drawing: Drawing, api: ChartApi): ReactNode {
    const pts = getChannelPoints(drawing)
    if (!pts) return null
    const isPreview = drawing.id < 0
    const color = getTimeframeColor(drawing.timeframe)

    const a = pointToPx(pts[0], api)
    const b = pointToPx(pts[1], api)
    if (!a || !b) return null

    // phase 1 プレビュー: 基準線のみ
    if (pts.length === 2) {
      return (
        <g>
          <line
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={color}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <circle cx={a.x} cy={a.y} r={3} fill={color} />
          <circle cx={b.x} cy={b.y} r={3} fill={color} />
        </g>
      )
    }

    // phase 2 / 確定: 3 点 → 基準線 + 平行線 + 帯
    const c = pointToPx(pts[2], api)
    if (!c) return null
    const offset = offsetThrough(pts[0], pts[1], pts[2])
    if (offset === null) {
      // degenerate: p1.t == p2.t、基準線のみ描画
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
          <circle cx={c.x} cy={c.y} r={3} fill={color} />
        </g>
      )
    }
    const a2 = pointToPx({ t: pts[0].t, price: pts[0].price + offset }, api)
    const b2 = pointToPx({ t: pts[1].t, price: pts[1].price + offset }, api)
    if (!a2 || !b2) return null

    return (
      <g>
        {/* 帯(基準線と平行線で囲まれた領域)*/}
        <polygon
          points={`${a.x},${a.y} ${b.x},${b.y} ${b2.x},${b2.y} ${a2.x},${a2.y}`}
          fill={color}
          fillOpacity={0.08}
          stroke="none"
        />
        {/* 基準線 p1-p2 */}
        <line
          x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={isPreview ? '4 3' : undefined}
        />
        {/* 平行線 (p3 を通る)*/}
        <line
          x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y}
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray={isPreview ? '4 3' : undefined}
        />
        <circle cx={a.x} cy={a.y} r={3} fill={color} />
        <circle cx={b.x} cy={b.y} r={3} fill={color} />
        <circle cx={c.x} cy={c.y} r={3} fill={color} />
      </g>
    )
  },
}
