import type { ReactNode } from 'react'
import type { Drawing } from '../../api/types'
import { getTimeframeColor } from '../../constants'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'

const HIT_RADIUS_PX = 12

// ver 1.63: 推進波 1-5 + 補正波 A/B/C を文字列で統一保存(JSON 上の型を 1 種類に揃える)
export type WaveValue = '1' | '2' | '3' | '4' | '5' | 'A' | 'B' | 'C'
export const WAVE_VALUES: readonly WaveValue[] = ['1', '2', '3', '4', '5', 'A', 'B', 'C'] as const
const WAVE_VALUE_SET: ReadonlySet<string> = new Set(WAVE_VALUES)

export function isWaveValue(v: unknown): v is WaveValue {
  return typeof v === 'string' && WAVE_VALUE_SET.has(v)
}

export type WaveLabelData = { t: number; price: number; wave: WaveValue }

export function getWaveLabelData(drawing: Drawing): WaveLabelData | null {
  const d = drawing.data
  if (typeof d.t !== 'number' || typeof d.price !== 'number') return null
  if (!isWaveValue(d.wave)) return null
  return { t: d.t as number, price: d.price as number, wave: d.wave }
}

export const waveLabelTool: ToolMetadata = {
  kind: 'wave_label',
  label: '波動',
  icon: '〜',
  defaultVisibleTfs: null,

  hitTest(drawing: Drawing, pointer: PointPx, api: ChartApi): HitResult | null {
    const d = getWaveLabelData(drawing)
    if (!d) return null
    const x = api.timeToX(d.t)
    const y = api.priceToY(d.price)
    if (x === null || y === null) return null
    if (Math.hypot(pointer.x - x, pointer.y - y) <= HIT_RADIUS_PX) {
      return { drawingId: drawing.id, kind: 'wave_label', part: 'body' }
    }
    return null
  },

  renderOverlay(drawing: Drawing, api: ChartApi): ReactNode {
    const d = getWaveLabelData(drawing)
    if (!d) return null
    const x = api.timeToX(d.t)
    const y = api.priceToY(d.price)
    if (x === null || y === null) return null
    const color = getTimeframeColor(drawing.timeframe)
    const isPreview = drawing.id < 0

    return (
      <g opacity={isPreview ? 0.6 : 1}>
        <circle cx={x} cy={y} r={9} fill={color} />
        <text
          x={x}
          y={y + 4}
          textAnchor="middle"
          fill="white"
          fontSize={11}
          fontWeight="bold"
          fontFamily="monospace"
        >
          {d.wave}
        </text>
      </g>
    )
  },
}
