import { useEffect, useRef } from 'react'
import type { MouseEventParams } from 'lightweight-charts'
import type { PointPx } from '../../drawing/types'
import type { ChartCore } from './useChartInstance'
import type { ChartCoordinates } from './useChartCoordinates'

export type MouseRelayHandlers = {
  onChartClick?: (price: number, time: number | null, px: PointPx) => void
  onMouseMove?: (price: number | null, time: number | null, px: PointPx) => void
  onMouseDown?: (price: number | null, time: number | null, px: PointPx) => void
  onMouseUp?: (price: number | null, time: number | null, px: PointPx) => void
}

/**
 * Chart instance に click / native mouse / wheel(Ctrl+ズーム)を attach し、価格 + 時刻 + px を
 * 上位 props へ中継する。
 *
 * - Ctrl+ホイール: マウス位置中心の logical zoom(Figma / Google Maps 流)
 * - 素のホイール: バブルしてページスクロールに任せる(LWC 標準のホイールズームは無効化済み)
 *
 * `handlers` は ref 経由で「最新 prop」を読むため、effect は `[containerRef, core, coords]`
 * のみに依存し、handler 変化では再 attach しない。
 */
export function useChartMouseRelay(
  containerRef: React.RefObject<HTMLDivElement | null>,
  core: ChartCore | null,
  coords: ChartCoordinates,
  handlers: MouseRelayHandlers,
): void {
  const handlerRefs = useRef<MouseRelayHandlers>(handlers)
  handlerRefs.current = handlers

  useEffect(() => {
    const container = containerRef.current
    if (!core || !container) return
    const { chart, series } = core
    const { pxToTime } = coords

    const toPx = (e: MouseEvent): PointPx => {
      const rect = container.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const clickHandler = (param: MouseEventParams) => {
      if (!param.point) return
      const price = series.coordinateToPrice(param.point.y)
      if (price == null) return
      // §5.3: バー範囲外でも描画できるよう、param.time が無い場合は外挿で時刻を求める
      const time = typeof param.time === 'number' ? param.time : pxToTime(param.point.x)
      handlerRefs.current.onChartClick?.(price, time, { x: param.point.x, y: param.point.y })
    }
    chart.subscribeClick(clickHandler)

    const mmHandler = (e: MouseEvent) => {
      const px = toPx(e)
      const rawPrice = series.coordinateToPrice(px.y)
      const price = typeof rawPrice === 'number' ? rawPrice : null
      const time = pxToTime(px.x)
      handlerRefs.current.onMouseMove?.(price, time, px)
    }
    const convert = (px: PointPx): { price: number | null; time: number | null } => {
      const rawPrice = series.coordinateToPrice(px.y)
      const price = typeof rawPrice === 'number' ? rawPrice : null
      return { price, time: pxToTime(px.x) }
    }
    const mdHandler = (e: MouseEvent) => {
      if (e.button !== 0) return
      const px = toPx(e)
      const { price, time } = convert(px)
      handlerRefs.current.onMouseDown?.(price, time, px)
    }
    const muHandler = (e: MouseEvent) => {
      if (e.button !== 0) return
      const px = toPx(e)
      const { price, time } = convert(px)
      handlerRefs.current.onMouseUp?.(price, time, px)
    }
    container.addEventListener('mousemove', mmHandler)
    container.addEventListener('mousedown', mdHandler, true)
    window.addEventListener('mouseup', muHandler)

    // §5.1.3: Ctrl+ホイール = 時間軸ズーム、素のホイール = ページスクロール
    const ZOOM_FACTOR = 1.1
    const wheelHandler = (e: WheelEvent) => {
      if (!e.ctrlKey) return  // 素のホイールはバブルしてページスクロールに委ねる
      e.preventDefault()
      const ts = chart.timeScale()
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
      chart.unsubscribeClick(clickHandler)
      container.removeEventListener('mousemove', mmHandler)
      container.removeEventListener('mousedown', mdHandler, true)
      container.removeEventListener('wheel', wheelHandler)
      window.removeEventListener('mouseup', muHandler)
    }
  }, [containerRef, core, coords])
}
