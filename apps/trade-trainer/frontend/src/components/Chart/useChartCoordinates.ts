import { useCallback, useMemo } from 'react'
import type { IChartApi, Logical, Time } from 'lightweight-charts'
import type { OhlcBar } from '../../api/client'
import { TIMEFRAME_MINUTES } from '../../constants'

export type ChartCoordinates = {
  /** chart 内 x 座標 → Unix 秒。範囲外は logical 経由で外挿 */
  pxToTime: (pxX: number) => number | null
  /** Unix 秒 → chart 内 x 座標。範囲外は logical 経由で外挿 */
  timeToPx: (time: number) => number | null
}

/**
 * §5.3 / §2 単一 Chart 内の x ↔ 時刻 ラッパ。
 *
 * - in-range は LWC `coordinateToTime` / `timeToCoordinate` をそのまま返す
 * - 範囲外(rightOffset whitespace 等)は `coordinateToLogical` + `logicalToCoordinate` 経由で
 *   `tfSec` に基づく線形外挿で px / time を補完する
 *
 * **TF 間 projection には使わない**(`timeToCoordinate` の null 経路があるため。
 * frontend-chart.md §2.4)。複数 chart 間の変換が必要な場合は LowerTfRangeOverlay の
 * 純粋関数経路を使う。
 *
 * 戻り値の関数は **stable identity**(useCallback で全依存が stable ref のため)。これにより
 * 上位 hook(useChartMouseRelay / useChartTestExposure)や ChartHandle の deps を増やさない。
 */
export function useChartCoordinates(
  chartRef: React.MutableRefObject<IChartApi | null>,
  barsRef: React.RefObject<OhlcBar[]>,
  tfRef: React.MutableRefObject<string>,
): ChartCoordinates {
  const pxToTime = useCallback((pxX: number): number | null => {
    const chart = chartRef.current
    if (!chart) return null
    const ts = chart.timeScale()
    const logical = ts.coordinateToLogical(pxX)
    if (logical == null) return null
    const bars = barsRef.current ?? []
    if (bars.length === 0) return null
    const lastIdx = bars.length - 1
    if (logical >= 0 && logical <= lastIdx) {
      const t = ts.coordinateToTime(pxX)
      return typeof t === 'number' ? t : null
    }
    const tfSec = (TIMEFRAME_MINUTES[tfRef.current] ?? 5) * 60
    if (logical > lastIdx) {
      return Math.floor(bars[lastIdx].t + (logical - lastIdx) * tfSec)
    }
    return Math.floor(bars[0].t + logical * tfSec)
  }, [chartRef, barsRef, tfRef])

  const timeToPx = useCallback((time: number): number | null => {
    const chart = chartRef.current
    if (!chart) return null
    const ts = chart.timeScale()
    const x = ts.timeToCoordinate(time as Time)
    if (x !== null) return x
    const bars = barsRef.current ?? []
    if (bars.length === 0) return null
    const tfSec = (TIMEFRAME_MINUTES[tfRef.current] ?? 5) * 60
    const lastIdx = bars.length - 1
    let logical: number
    if (time > bars[lastIdx].t) {
      logical = lastIdx + (time - bars[lastIdx].t) / tfSec
    } else if (time < bars[0].t) {
      logical = (time - bars[0].t) / tfSec
    } else {
      return null
    }
    return ts.logicalToCoordinate(logical as Logical) ?? null
  }, [chartRef, barsRef, tfRef])

  return useMemo(() => ({ pxToTime, timeToPx }), [pxToTime, timeToPx])
}
