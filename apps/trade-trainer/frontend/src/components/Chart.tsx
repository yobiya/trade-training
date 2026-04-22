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
import { INDICATORS } from '../indicators/registry'
import type { IndicatorConfig } from '../indicators/types'

export type PriceLine = {
  id: string | number
  price: number
  label?: string
  color?: string
}

export type ChartHandle = {
  api: ChartApi
  containerEl: HTMLDivElement | null
  /** チャートの再描画が必要なタイミング(時間軸変化・リサイズ等)でコールバックを呼ぶ。 */
  subscribeRedraw: (cb: () => void) => () => void
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
  onMouseDown?: (price: number | null, time: number | null, px: PointPx) => void
  onMouseUp?: (price: number | null, time: number | null, px: PointPx) => void
  /** チャートに重ねて表示する価格線。 */
  priceLines?: PriceLine[]
  /** チャートに重ねて表示するインジケーター。 */
  indicators?: IndicatorConfig[]
}

const RSI_SCALE_ID = 'rsi-pane'

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
  priceLines, indicators,
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
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const rsiPaneConfiguredRef = useRef(false)

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
        setScrollEnabled: (enabled: boolean) => {
          chartRef.current?.applyOptions({
            handleScroll: { pressedMouseMove: enabled, horzTouchDrag: enabled, vertTouchDrag: enabled },
            handleScale: { axisPressedMouseMove: enabled },
          })
        },
      }
    },
    get containerEl() { return containerRef.current },
    subscribeRedraw(cb: () => void) {
      const chart = chartRef.current
      const container = containerRef.current
      if (!chart || !container) return () => {}
      const handler = () => cb()
      chart.timeScale().subscribeVisibleLogicalRangeChange(handler)
      const ro = new ResizeObserver(() => cb())
      ro.observe(container)
      return () => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
        ro.disconnect()
      }
    },
  }), [])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 4 },
      // 仕様書 §5.1.3: 素のホイール = ページスクロール、Ctrl+ホイール = ズーム
      // ライブラリ標準のホイールズームを無効化し、自前の wheel ハンドラで分岐する
      handleScale: { mouseWheel: false },
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
    const convert = (px: PointPx): { price: number | null; time: number | null } => {
      const rawPrice = seriesRef.current?.coordinateToPrice(px.y)
      const price = typeof rawPrice === 'number' ? rawPrice : null
      const rawTime = chartRef.current?.timeScale().coordinateToTime(px.x)
      const time = typeof rawTime === 'number' ? rawTime : null
      return { price, time }
    }
    const mdHandler = (e: MouseEvent) => {
      if (e.button !== 0) return
      const px = toPx(e)
      const { price, time } = convert(px)
      onMouseDownRef.current?.(price, time, px)
    }
    const muHandler = (e: MouseEvent) => {
      if (e.button !== 0) return
      const px = toPx(e)
      const { price, time } = convert(px)
      onMouseUpRef.current?.(price, time, px)
    }
    container.addEventListener('mousemove', mmHandler)
    container.addEventListener('mousedown', mdHandler, true)
    window.addEventListener('mouseup', muHandler)

    // 仕様書 §5.1.3: Ctrl+ホイール = 時間軸ズーム、素のホイール = ページスクロール
    // マウス位置の logical 座標を中心にしてズームする(Figma/Google Maps 等に揃える)。
    const ZOOM_FACTOR = 1.1
    const wheelHandler = (e: WheelEvent) => {
      if (!e.ctrlKey) return  // 素のホイールはバブルしてページスクロールに委ねる
      e.preventDefault()
      const ts = chartRef.current?.timeScale()
      if (!ts) return
      const range = ts.getVisibleLogicalRange()
      if (!range) return
      const px = toPx(e as unknown as MouseEvent)
      const centerLogical = ts.coordinateToLogical(px.x)
      if (centerLogical == null) return
      const width = range.to - range.from
      const scale = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newWidth = width * scale
      const ratio = (centerLogical - range.from) / width
      const newFrom = centerLogical - newWidth * ratio
      const newTo = newFrom + newWidth
      ts.setVisibleLogicalRange({ from: newFrom, to: newTo })
    }
    // passive: false にしないと preventDefault できない
    container.addEventListener('wheel', wheelHandler, { passive: false })

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler)
      chart.unsubscribeClick(clickHandler)
      container.removeEventListener('mousemove', mmHandler)
      container.removeEventListener('mousedown', mdHandler, true)
      container.removeEventListener('wheel', wheelHandler)
      window.removeEventListener('mouseup', muHandler)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      fittedForTfRef.current = null
      earliestRef.current = null
      priceLineHandlesRef.current.clear()
      indicatorSeriesRef.current.clear()
      rsiPaneConfiguredRef.current = false
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

  // インジケーターの差分更新(仕様書 §5.2)。
  // - overlay: ローソク足と同じ右側価格軸に重ねる
  // - subpanel: RSI_SCALE_ID で別スケールを作り、下 25% に表示
  //
  // lightweight-charts v4 の priceScale はいずれかの系列が参照したときに生成されるため、
  // 順序は「系列追加/更新 → スケール設定」の順に行う必要がある。
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const seriesMap = indicatorSeriesRef.current
    const next = indicators ?? []
    const nextKeys = new Set(next.map(i => i.key))

    // 廃止されたインジケーターの series を削除
    for (const [key, s] of seriesMap) {
      if (!nextKeys.has(key)) {
        chart.removeSeries(s)
        seriesMap.delete(key)
      }
    }

    // 追加・更新
    for (const ind of next) {
      const spec = INDICATORS[ind.type]
      const data = spec.compute(bars, ind.params).map(p => ({
        time: p.time as Time,
        value: p.value,
      }))
      let s = seriesMap.get(ind.key)
      if (!s) {
        s = chart.addLineSeries({
          color: ind.color,
          lineWidth: 1,
          priceScaleId: spec.placement === 'subpanel' ? RSI_SCALE_ID : 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        })
        seriesMap.set(ind.key, s)
      } else {
        s.applyOptions({ color: ind.color })
      }
      s.setData(data)
    }

    // 系列追加後にスケールのマージンを構成する(サブパネル領域の確保)
    const hasSubpanel = next.some(i => INDICATORS[i.type].placement === 'subpanel')
    if (hasSubpanel) {
      // RSI 用のスケール(系列追加後なので参照可能)
      chart.priceScale(RSI_SCALE_ID).applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
        borderVisible: false,
      })
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } })
      rsiPaneConfiguredRef.current = true
    } else if (rsiPaneConfiguredRef.current) {
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 } })
      rsiPaneConfiguredRef.current = false
    }
  }, [indicators, bars])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: cursor ?? 'default' }}
    />
  )
})
