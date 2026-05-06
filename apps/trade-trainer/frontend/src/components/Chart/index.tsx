import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Logical } from 'lightweight-charts'
import type { OhlcBar } from '../../api/client'
import type { ChartApi, PointPx } from '../../drawing/types'
import type { IndicatorConfig } from '../../indicators/types'
import type { ChartHandle, ChartMarker, PriceLine } from './types'
import { useChartCandlestickData } from './useChartCandlestickData'
import { useChartCoordinates } from './useChartCoordinates'
import { useChartCrosshair } from './useChartCrosshair'
import { useChartHistoryLoad } from './useChartHistoryLoad'
import { useChartIndicators } from './useChartIndicators'
import { useChartInstance } from './useChartInstance'
import { useChartMarkers } from './useChartMarkers'
import { useChartMouseRelay } from './useChartMouseRelay'
import { useChartPriceFormat } from './useChartPriceFormat'
import { useChartPriceLines } from './useChartPriceLines'
import { useChartTestExposure } from './useChartTestExposure'

export type { ChartHandle, ChartMarker, PriceLine } from './types'

type Props = {
  bars: OhlcBar[]
  timeframe: string
  /** §5.1.3 (ver 1.72): 銘柄。symbol が変わったら setData + width preserve + 右端揃えで再 set する */
  symbol: string
  cursor?: string
  /** 価格表示の小数桁数(MT5 symbol_info.digits)。 */
  digits?: number
  /** チャートの可視範囲が左端に近づいた際の遅延ロード(loadMoreHistory)。最古バーの timestamp(秒)が渡る。 */
  onNeedMoreHistory?: (earliestUnix: number) => void
  /** クリック / マウス移動 / 押下 / 離上 の薄い中継。座標変換済みの Point を渡す。 */
  onChartClick?: (price: number, time: number | null, px: PointPx) => void
  onMouseMove?: (price: number | null, time: number | null, px: PointPx) => void
  onMouseDown?: (price: number | null, time: number | null, px: PointPx) => void
  onMouseUp?: (price: number | null, time: number | null, px: PointPx) => void
  /** チャートに重ねて表示する価格線。 */
  priceLines?: PriceLine[]
  /** §5.5.4 エントリー / 決済のマーカー(エントリー TF のチャートにのみ渡す)。 */
  markers?: ChartMarker[]
  /** チャートに重ねて表示するインジケーター。 */
  indicators?: IndicatorConfig[]
}

/**
 * 純粋なチャート描画コンポーネント。ツール固有のロジックは持たない。
 * 内部の責務は機能単位の private hook に分割している(`Chart/use*.ts`)。
 *
 * 詳細: docs/architecture/frontend-chart.md §1 / §4.3
 */
export const Chart = forwardRef<ChartHandle, Props>(function Chart({
  bars, timeframe, symbol, cursor, digits, onNeedMoreHistory,
  onChartClick, onMouseMove, onMouseDown, onMouseUp,
  priceLines, markers, indicators,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<OhlcBar[]>(bars)
  const tfRef = useRef<string>(timeframe)
  useEffect(() => { tfRef.current = timeframe }, [timeframe])

  // chart + series の lifecycle 管理。core は state、chartRef/seriesRef は同期 ref。
  const { core, chartRef, seriesRef } = useChartInstance(containerRef)

  // 座標変換ラッパ(stable ref deps なので識別子は不変)
  const coords = useChartCoordinates(chartRef, barsRef, tfRef)

  // 各機能の private hook(順序は §4.1 useEffect 役割表に対応)
  useChartCandlestickData(core, bars, timeframe, symbol, barsRef)
  useChartPriceFormat(core, digits)
  useChartPriceLines(core, priceLines)
  useChartMarkers(core, markers)
  useChartIndicators(core, indicators, bars)
  useChartHistoryLoad(core, barsRef, onNeedMoreHistory)
  useChartMouseRelay(containerRef, core, coords, { onChartClick, onMouseMove, onMouseDown, onMouseUp })
  useChartTestExposure(timeframe, core, coords)

  const { setCrosshair, subscribeUserCrosshair } = useChartCrosshair(core, chartRef, seriesRef, barsRef)

  /**
   * ChartHandle は **callback ref パターン**(SessionPage の `setChartRef(tf)`)で受け取られる。
   * callback ref は handle 識別子が変わっても再呼び出されないため、handle は **Chart instance の
   * 寿命を通して stable** でなければならない。各メソッドは ref 経由で最新の chart / series / coords
   * を読み、`useImperativeHandle` の deps は `[]`(全て stable ref / stable callback) に保つ。
   */
  useImperativeHandle(ref, () => ({
    get api(): ChartApi {
      return {
        priceToY: (price: number) => seriesRef.current?.priceToCoordinate(price) ?? null,
        yToPrice: (y: number) => {
          const p = seriesRef.current?.coordinateToPrice(y)
          return typeof p === 'number' ? p : null
        },
        timeToX: coords.timeToPx,
        xToTime: coords.pxToTime,
        logicalToX: (logical: number) => {
          const ts = chartRef.current?.timeScale()
          if (!ts) return null
          const x = ts.logicalToCoordinate(logical as Logical)
          return x ?? null
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
    takeScreenshot() {
      const chart = chartRef.current
      if (!chart) return null
      try {
        return chart.takeScreenshot().toDataURL('image/png')
      } catch {
        return null
      }
    },
    setCrosshair,
    subscribeUserCrosshair,
    getVisibleLogicalRange() {
      const range = chartRef.current?.timeScale().getVisibleLogicalRange()
      if (!range) return null
      return { from: range.from, to: range.to }
    },
  }), [chartRef, seriesRef, containerRef, coords, setCrosshair, subscribeUserCrosshair])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: cursor ?? 'default' }}
    />
  )
})
