import { useEffect, useState, type ReactElement } from 'react'
import type { Drawing } from '../api/client'
import { getTimeframeColor } from '../constants'
import { TOOLS } from '../drawing/tools/registry'
import type { ChartApi } from '../drawing/types'
import { isDrawingVisibleOnTf } from '../drawing/visibility'
import type { ChartHandle } from './Chart'

type Props = {
  chartHandle: ChartHandle | null
  drawings: Drawing[]
  preview: Drawing | null
  activeTimeframe: string
  /** ホバー中の描画 ID(§5.3 TF バッジ表示用) */
  hoveredId?: number | null
}

/**
 * 描画の端点付近に TF バッジ([H1] 等)を表示する。色覚配慮の補助情報(§5.3)。
 */
function tfBadge(d: Drawing, api: ChartApi): ReactElement | null {
  if (!d.timeframe) return null
  const pts = (d.data as { points?: { t: number; price: number }[] }).points
  let anchor: { x: number; y: number } | null = null
  if (pts && pts.length >= 1) {
    const x = api.timeToX(pts[0].t)
    const y = api.priceToY(pts[0].price)
    if (x !== null && y !== null) anchor = { x, y }
  } else if (d.kind === 'line') {
    const price = Number((d.data as { price: number }).price)
    const y = api.priceToY(price)
    if (y !== null) anchor = { x: 8, y }  // 左端寄りに配置
  }
  if (!anchor) return null
  const color = getTimeframeColor(d.timeframe)
  const label = `[${d.timeframe}]`
  const padX = 3
  const padY = 1
  const textWidth = label.length * 6  // ざっくりの幅見積もり
  const bx = anchor.x + 6
  const by = anchor.y - 12
  return (
    <g key={`badge-${d.id}`}>
      <rect x={bx} y={by} width={textWidth + padX * 2} height={14} rx={2}
        fill="#000" fillOpacity={0.6} stroke={color} strokeWidth={0.8} />
      <text x={bx + padX} y={by + 14 - padY - 2} fill={color} fontSize={10} fontFamily="monospace">
        {label}
      </text>
    </g>
  )
}

/**
 * チャートに重ねる SVG レイヤ。ツールの renderOverlay を呼んで描画する。
 * ポインタは透過(pointer-events: none)し、ヒットテストは IdleMode 側で行う。
 */
export function DrawingOverlay({ chartHandle, drawings, preview, activeTimeframe, hoveredId }: Props) {
  // チャートのズーム・パン・リサイズで SVG を再描画させる
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!chartHandle) return
    return chartHandle.subscribeRedraw(() => setTick(t => t + 1))
  }, [chartHandle])

  if (!chartHandle) return null
  const api = chartHandle.api

  const visible = drawings.filter(d => isDrawingVisibleOnTf(d, activeTimeframe))
  const hovered = hoveredId != null ? visible.find(d => d.id === hoveredId) : null

  return (
    <svg
      className="drawing-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}
      width="100%"
      height="100%"
    >
      {visible.map(d => {
        const tool = TOOLS[d.kind]
        if (!tool?.renderOverlay) return null
        return <g key={`d-${d.id}`}>{tool.renderOverlay(d, api)}</g>
      })}
      {preview && TOOLS[preview.kind]?.renderOverlay && (
        <g key="preview" opacity={0.85}>
          {TOOLS[preview.kind]!.renderOverlay!(preview, api)}
        </g>
      )}
      {hovered && tfBadge(hovered, api)}
    </svg>
  )
}
