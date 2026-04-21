import type { ReactNode } from 'react'
import type { Drawing } from '../../api/types'
import { getTimeframeColor } from '../../constants'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'

// 標準的なリトレースメントレベル
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const LINE_HIT_TOLERANCE_PX = 6
const HANDLE_HIT_TOLERANCE_PX = 8

type FP = { t: number; price: number }

export function getFibPoints(drawing: Drawing): FP[] | null {
  const pts = drawing.data.points as unknown
  if (!Array.isArray(pts) || pts.length !== 2) return null
  return pts.map(p => ({ t: Number((p as FP).t), price: Number((p as FP).price) }))
}

/**
 * レベル → 価格の対応を返す。points[0] を 100%、points[1] を 0% と解釈する
 * (仕様書 §5.3 "フィボナッチリトレースメント")
 */
function priceAtLevel(pts: FP[], level: number): number {
  const [a, b] = pts
  return a.price * level + b.price * (1 - level)
}

export const fibonacciTool: ToolMetadata = {
  kind: 'fibonacci',
  label: 'フィボ',
  icon: '📐',
  // 仕様書 §5.3: 作成時間足のみ(visible_on_timeframes が null の場合、
  // isVisibleOnTf が kind 既定を用いて timeframe === 現在TF で判定する)
  defaultVisibleTfs: null,

  hitTest(drawing: Drawing, pointer: PointPx, api: ChartApi): HitResult | null {
    const pts = getFibPoints(drawing)
    if (!pts) return null
    const xA = api.timeToX(pts[0].t)
    const xB = api.timeToX(pts[1].t)
    const yA = api.priceToY(pts[0].price)
    const yB = api.priceToY(pts[1].price)
    if (xA === null || xB === null || yA === null || yB === null) return null

    // 端点判定
    if (Math.hypot(pointer.x - xA, pointer.y - yA) < HANDLE_HIT_TOLERANCE_PX) {
      return { drawingId: drawing.id, kind: 'fibonacci', part: 'handle', handleIndex: 0 }
    }
    if (Math.hypot(pointer.x - xB, pointer.y - yB) < HANDLE_HIT_TOLERANCE_PX) {
      return { drawingId: drawing.id, kind: 'fibonacci', part: 'handle', handleIndex: 1 }
    }

    // body: 2 点の x 範囲内 + いずれかのレベル線に近い
    const [x1, x2] = xA < xB ? [xA, xB] : [xB, xA]
    if (pointer.x >= x1 - LINE_HIT_TOLERANCE_PX && pointer.x <= x2 + LINE_HIT_TOLERANCE_PX) {
      for (const level of FIB_LEVELS) {
        const y = api.priceToY(priceAtLevel(pts, level))
        if (y === null) continue
        if (Math.abs(pointer.y - y) < LINE_HIT_TOLERANCE_PX) {
          return { drawingId: drawing.id, kind: 'fibonacci', part: 'body' }
        }
      }
    }
    return null
  },

  renderOverlay(drawing: Drawing, api: ChartApi): ReactNode {
    const pts = getFibPoints(drawing)
    if (!pts) return null
    const xA = api.timeToX(pts[0].t)
    const xB = api.timeToX(pts[1].t)
    const yA = api.priceToY(pts[0].price)
    const yB = api.priceToY(pts[1].price)
    if (xA === null || xB === null || yA === null || yB === null) return null

    const [x1, x2] = xA < xB ? [xA, xB] : [xB, xA]
    const isPreview = drawing.id < 0
    const color = getTimeframeColor(drawing.timeframe)

    return (
      <g>
        {/* レベル線 */}
        {FIB_LEVELS.map(level => {
          const price = priceAtLevel(pts, level)
          const y = api.priceToY(price)
          if (y === null) return null
          return (
            <g key={level}>
              <line
                x1={x1} y1={y} x2={x2} y2={y}
                stroke={color}
                strokeWidth={0.8}
                strokeOpacity={0.7}
                strokeDasharray={isPreview ? '4 3' : undefined}
              />
              <text
                x={x1 + 4}
                y={y - 2}
                fill={color}
                fontSize={10}
                fontFamily="monospace"
              >
                {(level * 100).toFixed(1)}%
              </text>
            </g>
          )
        })}
        {/* A-B 対角線(視覚的アンカー) */}
        <line
          x1={xA} y1={yA} x2={xB} y2={yB}
          stroke={color}
          strokeWidth={1}
          strokeOpacity={0.35}
          strokeDasharray="2 3"
        />
        {/* 端点マーカー */}
        <circle cx={xA} cy={yA} r={3} fill={color} />
        <circle cx={xB} cy={yB} r={3} fill={color} />
      </g>
    )
  },
}
