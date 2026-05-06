import { useCallback, useEffect, useRef } from 'react'
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts'
import type { OhlcBar } from '../../api/client'
import type { ChartCore } from './useChartInstance'

export type ChartCrosshairApi = {
  /**
   * §5.1.2 命令的にクロスヘアを置く / クリア(他チャートからの同期用)。
   * `time` は bars 配列内の最寄りバーへ snap、`price` はそのまま使う(同一銘柄なので価格軸は
   * TF 間で共有、snap 不要)。例外は捕捉してクラッシュさせない。
   * `time` が null のときは price も無視して clearCrosshairPosition。
   */
  setCrosshair: (time: number | null, price: number | null) => void
  /**
   * §5.1.2 ユーザー操作によるクロスヘア移動を購読。`setCrosshairPosition` 由来の programmatic
   * な move は通知しない(`param.sourceEvent === undefined` でフィルタ)。これによりマルチ TF
   * 同期で feedback ループが構造的に発生しない。
   * price はマウスの y 座標から `series.coordinateToPrice` で換算した値。
   */
  subscribeUserCrosshair: (cb: (time: number | null, price: number | null) => void) => () => void
}

/**
 * §5.1.2 クロスヘア同期 API。
 *
 * - `core` が ready になったら `subscribeCrosshairMove` で購読を attach
 * - 公開する 2 メソッドは **stable identity**(useCallback で stable ref deps)
 * - ChartHandle が `[]` deps で stable に保てるよう、本 hook の返値をそのまま流せる
 */
export function useChartCrosshair(
  core: ChartCore | null,
  chartRef: React.MutableRefObject<IChartApi | null>,
  seriesRef: React.MutableRefObject<ISeriesApi<'Candlestick'> | null>,
  barsRef: React.RefObject<OhlcBar[]>,
): ChartCrosshairApi {
  const userCrosshairSubsRef = useRef<Set<(time: number | null, price: number | null) => void>>(new Set())

  useEffect(() => {
    if (!core) return
    const { chart, series } = core
    const handler = (param: MouseEventParams) => {
      // sourceEvent が undefined = programmatic(setCrosshairPosition 由来)→ skip
      if (param.sourceEvent === undefined) return
      const t = typeof param.time === 'number' ? param.time : null
      // y 座標から price を換算(pane 外 / 範囲外では null)
      let price: number | null = null
      if (param.point && typeof param.point.y === 'number') {
        const p = series.coordinateToPrice(param.point.y)
        if (typeof p === 'number' && Number.isFinite(p)) price = p
      }
      for (const cb of userCrosshairSubsRef.current) cb(t, price)
    }
    chart.subscribeCrosshairMove(handler)
    return () => {
      chart.unsubscribeCrosshairMove(handler)
    }
  }, [core])

  const setCrosshair = useCallback((time: number | null, price: number | null) => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return
    if (time == null) {
      chart.clearCrosshairPosition()
      return
    }
    const currentBars = barsRef.current ?? []
    if (currentBars.length === 0) return
    // bars はソート済(by t)。time 以下の最大 bar(or 最寄りの bar)を線形検索
    let nearest: OhlcBar | null = null
    for (const b of currentBars) {
      if (b.t > time) break
      nearest = b
    }
    if (!nearest) nearest = currentBars[0]
    // §5.1.2: 価格軸は同一銘柄なら TF 間で共有 → 受け取った price をそのまま使う。
    // null(他 TF が pane 外で価格を取得できていない等)は nearest.c で代替。
    const displayPrice = price != null && Number.isFinite(price) ? price : nearest.c
    try {
      chart.setCrosshairPosition(displayPrice, nearest.t as Time, series)
    } catch {
      // series に該当 time が無い等で失敗してもクラッシュさせない
    }
  }, [chartRef, seriesRef, barsRef])

  const subscribeUserCrosshair = useCallback((cb: (time: number | null, price: number | null) => void) => {
    userCrosshairSubsRef.current.add(cb)
    return () => {
      userCrosshairSubsRef.current.delete(cb)
    }
  }, [])

  return { setCrosshair, subscribeUserCrosshair }
}
