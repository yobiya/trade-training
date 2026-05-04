import { useEffect, useRef, useState } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'

export type ChartCore = {
  chart: IChartApi
  series: ISeriesApi<'Candlestick'>
}

/**
 * §4.2 lightweight-charts の chart + candlestick series を 1 度だけ作り、unmount 時に
 * `chart.remove()` で破棄する。SessionPage で `<Chart key={tf}>` により TF 単位で
 * Chart instance が固定される前提なので、本 hook の effect は `[]` deps で 1 回だけ走る。
 *
 * 戻り値:
 * - `core`: state 経由。null から始まり、初期化完了後に `{ chart, series }` に切り替わる。
 *   依存 hook はこれを effect deps に入れて「chart 準備完了」を検知する。
 * - `chartRef` / `seriesRef`: ref 経由。**ChartHandle が `[]` deps で stable 公開する**ために、
 *   handle メソッドが core ではなくこの ref を読むことで identity を変えずに最新値を取れる。
 *   state と同タイミングで同期更新する(同じ effect 内で `chartRef.current = chart` する)。
 */
export function useChartInstance(
  containerRef: React.RefObject<HTMLDivElement>,
): {
  core: ChartCore | null
  chartRef: React.MutableRefObject<IChartApi | null>
  seriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>
} {
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [core, setCore] = useState<ChartCore | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 4 },
      // ローソク足の上下余白(LWC 既定の半分: top 0.2→0.1, bottom 0.1→0.05)
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.05 } },
      // §5.1.3: 素のホイール = ページスクロール、Ctrl+ホイール = ズーム。
      // ライブラリ標準のホイールズームを切って useChartMouseRelay に任せる。
      handleScale: { mouseWheel: false },
      // クロスヘアをカーソル位置に追従(既定の Magnet は直近バー close にスナップする)
      crosshair: { mode: CrosshairMode.Normal },
    })
    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    chartRef.current = chart
    seriesRef.current = series
    setCore({ chart, series })
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      setCore(null)
    }
  }, [containerRef])

  return { core, chartRef, seriesRef }
}
