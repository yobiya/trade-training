import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createChart, LineStyle } from 'lightweight-charts'
import type {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  CandlestickData,
  LogicalRange,
  MouseEventParams,
  Time,
} from 'lightweight-charts'
import type { OhlcBar } from '../api/client'
import type { ChartApi, PointPx } from '../drawing/types'

export type PriceLine = {
  id: string | number
  price: number
  label?: string
  color?: string
}

export type ChartHandle = {
  api: ChartApi
  containerEl: HTMLDivElement | null
}

type Props = {
  bars: OhlcBar[]
  timeframe: string
  cursor?: string
  /** 価格表示の小数桁数(MT5 symbol_info.digits)。 */
  digits?: number
  /** 可視範囲の左端がデータ範囲を超えたときに呼ばれる(遅延ロード用)。 */
  onNeedMoreHistory?: (earliest: number) => void
  /** クリック / マウス移動 / 押下 / 離上 の薄い中継。座標変換済みの Point を渡す。 */
  onChartClick?: (price: number, time: number | null, px: PointPx) => void
  onMouseMove?: (price: number | null, time: number | null, px: PointPx) => void
  onMouseDown?: (px: PointPx) => void
  onMouseUp?: (px: PointPx) => void
  /** チャートに重ねて表示する価格線。 */
  priceLines?: PriceLine[]
}

function toCandle(bar: OhlcBar): CandlestickData {
  return { time: bar.t as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c }
}

const LOAD_MORE_THRESHOLD = 0

/**
 * 純粋なチャート描画コンポーネント。ツール固有のロジックは持たない。
 * - ろうそく足 + priceLines をレンダ
 * - クリック・マウス移動・押下・離上 を上位へ中継
 * - 座標変換 API を ref 経由で公開
 */
export const Chart = forwardRef<ChartHandle, Props>(function Chart({
  bars, timeframe, cursor, digits, onNeedMoreHistory,
  onChartClick, onMouseMove, onMouseDown, onMouseUp,
  priceLines,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const fittedForTfRef = useRef<string | null>(null)
  const earliestRef = useRef<number | null>(null)
  const onNeedMoreRef = useRef(onNeedMoreHistory)
  const onChartClickRef = useRef(onChartClick)
  const onMouseMoveRef = useRef(onMouseMove)
  const onMouseDownRef = useRef(onMouseDown)
  const onMouseUpRef = useRef(onMouseUp)
  const priceLineHandlesRef = useRef<Map<string | number, IPriceLine>>(new Map())

  useEffect(() => { onNeedMoreRef.current = onNeedMoreHistory }, [onNeedMoreHistory])
  useEffect(() => { onChartClickRef.current = onChartClick }, [onChartClick])
  useEffect(() => { onMouseMoveRef.current = onMouseMove }, [onMouseMove])
  useEffect(() => { onMouseDownRef.current = onMouseDown }, [onMouseDown])
  useEffect(() => { onMouseUpRef.current = onMouseUp }, [onMouseUp])

  useImperativeHandle(ref, () => ({
    get api(): ChartApi {
      return {
        priceToY: (price: number) => seriesRef.current?.priceToCoordinate(price) ?? null,
        yToPrice: (y: number) => {
          const p = seriesRef.current?.coordinateToPrice(y)
          return typeof p === 'number' ? p : null
        },
        timeToX: (time: number) => chartRef.current?.timeScale().timeToCoordinate(time as Time) ?? null,
        xToTime: (x: number) => {
          const t = chartRef.current?.timeScale().coordinateToTime(x)
          return typeof t === 'number' ? t : null
        },
      }
    },
    get containerEl() { return containerRef.current },
  }), [])

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

    const rangeHandler = (range: LogicalRange | null) => {
      if (!range) return
      if (range.from < LOAD_MORE_THRESHOLD && earliestRef.current !== null) {
        onNeedMoreRef.current?.(earliestRef.current)
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler)

    const clickHandler = (param: MouseEventParams) => {
      if (!param.point || !seriesRef.current) return
      const price = seriesRef.current.coordinateToPrice(param.point.y)
      if (price == null) return
      const time = typeof param.time === 'number' ? param.time : null
      onChartClickRef.current?.(price, time, { x: param.point.x, y: param.point.y })
    }
    chart.subscribeClick(clickHandler)

    // ネイティブ DOM イベントは上位(hook)へ中継
    const container = containerRef.current
    const toPx = (e: MouseEvent): PointPx => {
      const rect = container.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const mmHandler = (e: MouseEvent) => {
      const px = toPx(e)
      const price = seriesRef.current ? seriesRef.current.coordinateToPrice(px.y) : null
      const tRaw = chartRef.current?.timeScale().coordinateToTime(px.x)
      const time = typeof tRaw === 'number' ? tRaw : null
      onMouseMoveRef.current?.(typeof price === 'number' ? price : null, time, px)
    }
    const mdHandler = (e: MouseEvent) => {
      if (e.button !== 0) return
      onMouseDownRef.current?.(toPx(e))
    }
    const muHandler = (e: MouseEvent) => {
      if (e.button !== 0) return
      onMouseUpRef.current?.(toPx(e))
    }
    container.addEventListener('mousemove', mmHandler)
    container.addEventListener('mousedown', mdHandler, true)
    window.addEventListener('mouseup', muHandler)

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler)
      chart.unsubscribeClick(clickHandler)
      container.removeEventListener('mousemove', mmHandler)
      container.removeEventListener('mousedown', mdHandler, true)
      window.removeEventListener('mouseup', muHandler)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      fittedForTfRef.current = null
      earliestRef.current = null
      priceLineHandlesRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current || bars.length === 0) return
    seriesRef.current.setData(bars.map(toCandle))
    earliestRef.current = bars[0].t
    if (fittedForTfRef.current !== timeframe) {
      chartRef.current?.timeScale().fitContent()
      fittedForTfRef.current = timeframe
    }
  }, [bars, timeframe])

  // 価格スケール・priceLine ラベルの精度を digits に合わせる
  useEffect(() => {
    if (!seriesRef.current || digits == null) return
    seriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision: digits,
        minMove: Math.pow(10, -digits),
      },
    })
  }, [digits])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const handles = priceLineHandlesRef.current
    const nextIds = new Set(priceLines?.map(pl => pl.id) ?? [])

    for (const [id, handle] of handles) {
      if (!nextIds.has(id)) {
        series.removePriceLine(handle)
        handles.delete(id)
      }
    }
    for (const pl of priceLines ?? []) {
      const existing = handles.get(pl.id)
      if (existing) {
        existing.applyOptions({ price: pl.price, title: pl.label ?? '', color: pl.color ?? '#58a6ff' })
      } else {
        const h = series.createPriceLine({
          price: pl.price,
          color: pl.color ?? '#58a6ff',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: pl.label ?? '',
        })
        handles.set(pl.id, h)
      }
    }
  }, [priceLines])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: cursor ?? 'default' }}
    />
  )
})
