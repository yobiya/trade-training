import { useEffect, useRef } from 'react'
import type { CandlestickData, IChartApi, Time } from 'lightweight-charts'
import type { OhlcBar } from '../../api/client'
import { DEFAULT_VISIBLE_BARS } from '../../constants'
import type { ChartCore } from './useChartInstance'

/** lightweight-charts の `timeScale.options.rightOffset` と同値(右端余白のバー幅)。 */
const RIGHT_OFFSET = 4

function toCandle(bar: OhlcBar): CandlestickData {
  return { time: bar.t as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c }
}

/**
 * §5.1.3 指定 width で右端揃えの visible logical range を適用する。
 * バー数が width 未満の TF(broker ヒストリ不足等)では `fitContent()` でフォールバック。
 */
function applyVisibleRange(chart: IChartApi, barsLength: number, width: number): void {
  if (barsLength <= 0) return
  if (barsLength < width) {
    chart.timeScale().fitContent()
    return
  }
  const to = barsLength - 1 + RIGHT_OFFSET
  const from = to - width
  chart.timeScale().setVisibleLogicalRange({ from, to })
}

/**
 * §5.1.3 / §4.2 bars / timeframe / symbol を反映して `series.setData` する。
 *
 * - 初回(timeframe 初登場): 既定 width で右端揃え
 * - symbol 変化: 直前 visible range の width を保持 → setData → 新 bars の右端へ揃え
 * - 同 symbol 内の bars 変化(advance / loadMoreHistory): visible range を触らない(LWC が保持)
 *
 * 副作用として `barsRef.current = bars` を毎回更新する。useChartCoordinates / useChartCrosshair /
 * useChartHistoryLoad が ref 経由で最新 bars を読むため、setData と同時に同期更新する必要がある。
 */
export function useChartCandlestickData(
  core: ChartCore | null,
  bars: OhlcBar[],
  timeframe: string,
  symbol: string,
  barsRef: React.MutableRefObject<OhlcBar[]>,
): void {
  const fittedForTfRef = useRef<string | null>(null)
  const prevSymbolRef = useRef<string | null>(null)

  // chart instance(StrictMode 含む)が変わるときに「初回扱い」へ戻す
  useEffect(() => {
    return () => {
      fittedForTfRef.current = null
      prevSymbolRef.current = null
    }
  }, [core])

  useEffect(() => {
    barsRef.current = bars
    if (!core || bars.length === 0) return
    const { chart, series } = core

    const isFirstMountForTf = fittedForTfRef.current !== timeframe
    const symbolChanged =
      !isFirstMountForTf
      && prevSymbolRef.current !== null
      && prevSymbolRef.current !== symbol

    let preservedWidth: number | null = null
    if (symbolChanged) {
      const r = chart.timeScale().getVisibleLogicalRange()
      if (r) preservedWidth = r.to - r.from
    }

    series.setData(bars.map(toCandle))

    if (isFirstMountForTf) {
      applyVisibleRange(chart, bars.length, DEFAULT_VISIBLE_BARS)
      fittedForTfRef.current = timeframe
    } else if (symbolChanged && preservedWidth != null) {
      applyVisibleRange(chart, bars.length, preservedWidth)
    }
    // 同 symbol の bars 変化: 何もしない(LWC が visible range を維持する、§3.3 setData の暗黙副作用)

    prevSymbolRef.current = symbol
  }, [core, bars, timeframe, symbol, barsRef])
}
