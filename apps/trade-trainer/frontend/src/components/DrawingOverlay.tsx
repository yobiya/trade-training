import { useEffect, useState } from 'react'
import type { Drawing } from '../api/client'
import { TOOLS } from '../drawing/tools/registry'
import type { ChartHandle } from './Chart'

type Props = {
  chartHandle: ChartHandle | null
  drawings: Drawing[]
  preview: Drawing | null
  activeTimeframe: string
}

function isVisibleOnTf(d: Drawing, tf: string): boolean {
  if (d.visible_on_timeframes) return d.visible_on_timeframes.includes(tf)
  if (d.kind === 'line' || d.kind === 'trendline') return true
  return d.timeframe === tf
}

/**
 * チャートに重ねる SVG レイヤ。ツールの renderOverlay を呼んで描画する。
 * ポインタは透過(pointer-events: none)し、ヒットテストは IdleMode 側で行う。
 */
export function DrawingOverlay({ chartHandle, drawings, preview, activeTimeframe }: Props) {
  // チャートのズーム・パン・リサイズで SVG を再描画させる
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!chartHandle) return
    return chartHandle.subscribeRedraw(() => setTick(t => t + 1))
  }, [chartHandle])

  if (!chartHandle) return null
  const api = chartHandle.api

  const visible = drawings.filter(d => isVisibleOnTf(d, activeTimeframe))

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
    </svg>
  )
}
