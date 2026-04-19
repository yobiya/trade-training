import { useEffect, useRef } from 'react'
import { createChart } from 'lightweight-charts'
import type {
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LogicalRange,
  Time,
} from 'lightweight-charts'
import type { OhlcBar } from '../api/client'

type Props = {
  bars: OhlcBar[]
  timeframe: string
  /**
   * 可視範囲が取得済みデータの左端を超えそうになったときに呼ばれる。
   * earliest は現状の最古バーの UNIX 秒。呼び出し側で重複ガードとローディング制御を行う。
   */
  onNeedMoreHistory?: (earliest: number) => void
}

function toCandle(bar: OhlcBar): CandlestickData {
  return { time: bar.t as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c }
}

// 可視範囲の左端がこの値未満になったら追加取得を要求する。
// 0 未満 = ユーザーがズームアウトしてデータ範囲より左側に余白ができた状態のみ発火
// (初期 fitContent 直後は from=0 なので自動発火しない)。
const LOAD_MORE_THRESHOLD = 0

export function Chart({ bars, timeframe, onNeedMoreHistory }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const fittedForTfRef = useRef<string | null>(null)
  const earliestRef = useRef<number | null>(null)
  const onNeedMoreRef = useRef(onNeedMoreHistory)

  useEffect(() => { onNeedMoreRef.current = onNeedMoreHistory }, [onNeedMoreHistory])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 4 },
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

    const handler = (range: LogicalRange | null) => {
      if (!range) return
      if (range.from < LOAD_MORE_THRESHOLD && earliestRef.current !== null) {
        onNeedMoreRef.current?.(earliestRef.current)
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler)

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      fittedForTfRef.current = null
      earliestRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current || bars.length === 0) return
    seriesRef.current.setData(bars.map(toCandle))
    earliestRef.current = bars[0].t
    // 時間足が切り替わった直後は改めて全体をフィットする。
    // 同一時間足内(足送り・遅延ロードなど)はユーザーのズーム位置を維持する。
    if (fittedForTfRef.current !== timeframe) {
      chartRef.current?.timeScale().fitContent()
      fittedForTfRef.current = timeframe
    }
  }, [bars, timeframe])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
