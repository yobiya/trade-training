import { useEffect, useState } from 'react'
import type { EconomicEvent } from '../api/types'
import type { ChartApi } from '../drawing/types'
import { formatJST } from '../utils/datetime'
import type { ChartHandle } from './Chart'

/** 通貨別マーカー色(通貨をまたぐ認識のため、時間足色とは別系統にする)。 */
const CURRENCY_COLOR: Record<string, string> = {
  USD: '#58a6ff',
  JPY: '#f78166',
  EUR: '#bc8cff',
  GBP: '#7ee787',
  AUD: '#ffab70',
  CAD: '#ff7b72',
  CHF: '#d2a8ff',
  NZD: '#f0883e',
}

function colorFor(currency: string): string {
  return CURRENCY_COLOR[currency] ?? '#8b949e'
}

function importanceStars(importance: number): string {
  return '★'.repeat(Math.max(0, Math.min(3, importance)))
}

function formatValue(v: number | null): string {
  if (v === null) return '—'
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

type Props = {
  chartHandle: ChartHandle | null
  events: EconomicEvent[]
  shadingBeforeMin: number
  shadingAfterMin: number
  /** アクティブチャートのみ設定。ツールチップはこのイベントについて表示する。 */
  hoveredEvent?: EconomicEvent | null
}

/**
 * 経済指標を縦線 + シェーディングでチャートに重ねる SVG レイヤ(仕様書 §5.4)。
 * pointer-events: none に保ち、チャート操作を阻害しない。
 * ツールチップは SessionPage 側でカーソル近接を算出し hoveredEvent で渡す。
 */
export function EventOverlay({
  chartHandle, events, shadingBeforeMin, shadingAfterMin, hoveredEvent,
}: Props) {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!chartHandle) return
    return chartHandle.subscribeRedraw(() => setTick(t => t + 1))
  }, [chartHandle])

  if (!chartHandle || events.length === 0) return null
  const api: ChartApi = chartHandle.api

  const beforeSec = shadingBeforeMin * 60
  const afterSec = shadingAfterMin * 60

  // ツールチップの x 位置(hover 中の event に対応)
  let tooltipX: number | null = null
  if (hoveredEvent) {
    const t = Math.floor(new Date(hoveredEvent.event_time).getTime() / 1000)
    tooltipX = api.timeToX(t)
  }

  return (
    <>
      <svg
        className="event-overlay"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}
        width="100%"
        height="100%"
      >
        {events.map(ev => {
          const t = Math.floor(new Date(ev.event_time).getTime() / 1000)
          const x = api.timeToX(t)
          if (x === null) return null
          const xLeft = api.timeToX(t - beforeSec) ?? x
          const xRight = api.timeToX(t + afterSec) ?? x
          const width = Math.max(0, xRight - xLeft)
          const color = colorFor(ev.currency)
          const isHovered = hoveredEvent?.id === ev.id

          return (
            <g key={ev.id}>
              {width > 0 && (
                <rect
                  x={xLeft}
                  y={0}
                  width={width}
                  height="100%"
                  fill={color}
                  fillOpacity={isHovered ? 0.12 : 0.06}
                />
              )}
              <line
                x1={x} y1={0} x2={x} y2="100%"
                stroke={color}
                strokeWidth={isHovered ? 2 : 1}
                strokeOpacity={isHovered ? 1 : 0.8}
                strokeDasharray={isHovered ? undefined : '3 2'}
              />
              <text
                x={x + 3}
                y={12}
                fill={color}
                fontSize={10}
                fontFamily="monospace"
                opacity={isHovered ? 1 : 0.9}
              >
                {ev.currency}
              </text>
            </g>
          )
        })}
      </svg>
      {hoveredEvent && tooltipX !== null && (
        <div
          className="event-tooltip"
          style={{
            position: 'absolute',
            left: Math.max(4, tooltipX + 8),
            top: 20,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          <div className="event-tooltip-header" style={{ color: colorFor(hoveredEvent.currency) }}>
            <span className="event-tooltip-stars">{importanceStars(hoveredEvent.importance)}</span>
            <span className="event-tooltip-currency">{hoveredEvent.currency}</span>
          </div>
          <div className="event-tooltip-name">{hoveredEvent.name}</div>
          <div className="event-tooltip-time">{formatJST(hoveredEvent.event_time)}</div>
          <table className="event-tooltip-values">
            <tbody>
              <tr>
                <td>実測</td>
                <td>{formatValue(hoveredEvent.actual)}</td>
              </tr>
              <tr>
                <td>予想</td>
                <td>{formatValue(hoveredEvent.forecast)}</td>
              </tr>
              <tr>
                <td>前回</td>
                <td>{formatValue(hoveredEvent.previous)}</td>
              </tr>
              {hoveredEvent.surprise !== null && (
                <tr>
                  <td>サプライズ</td>
                  <td>{hoveredEvent.surprise > 0 ? '+' : ''}{hoveredEvent.surprise.toFixed(2)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
