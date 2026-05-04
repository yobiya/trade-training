import { useCallback, useEffect, useRef } from 'react'
import type { IChartApi, ISeriesApi, MouseEventParams, Time } from 'lightweight-charts'
import type { OhlcBar } from '../../api/client'
import type { ChartCore } from './useChartInstance'

export type ChartCrosshairApi = {
  /**
   * 命令的にクロスヘアを置く / クリア(他チャートからの同期用)。
   * bars に該当時刻が無い場合は最寄りバーへスナップ。例外は捕捉してクラッシュさせない。
   */
  setCrosshairTime: (time: number | null) => void
  /**
   * ユーザー操作によるクロスヘア移動を購読。`setCrosshairPosition` 由来の programmatic な move
   * は通知しない(`param.sourceEvent === undefined` でフィルタ)。これによりマルチ TF 同期で
   * feedback ループが構造的に発生しない。
   */
  subscribeUserCrosshair: (cb: (time: number | null) => void) => () => void
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
  const userCrosshairSubsRef = useRef<Set<(time: number | null) => void>>(new Set())

  useEffect(() => {
    if (!core) return
    const { chart } = core
    const handler = (param: MouseEventParams) => {
      // sourceEvent が undefined = programmatic(setCrosshairPosition 由来)→ skip
      if (param.sourceEvent === undefined) return
      const t = typeof param.time === 'number' ? param.time : null
      for (const cb of userCrosshairSubsRef.current) cb(t)
    }
    chart.subscribeCrosshairMove(handler)
    return () => {
      chart.unsubscribeCrosshairMove(handler)
    }
  }, [core])

  const setCrosshairTime = useCallback((time: number | null) => {
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
    try {
      chart.setCrosshairPosition(nearest.c, nearest.t as Time, series)
    } catch {
      // series に該当 time が無い等で失敗してもクラッシュさせない
    }
  }, [chartRef, seriesRef, barsRef])

  const subscribeUserCrosshair = useCallback((cb: (time: number | null) => void) => {
    userCrosshairSubsRef.current.add(cb)
    return () => {
      userCrosshairSubsRef.current.delete(cb)
    }
  }, [])

  return { setCrosshairTime, subscribeUserCrosshair }
}
