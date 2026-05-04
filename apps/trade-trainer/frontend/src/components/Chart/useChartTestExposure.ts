import { useEffect } from 'react'
import type { ISeriesApi } from 'lightweight-charts'
import type { ChartCoordinates } from './useChartCoordinates'
import type { ChartCore } from './useChartInstance'

type ChartTestEntry = {
  priceToY(p: number): number | null
  yToPrice(y: number): number | null
  timeToX(t: number): number | null
  xToTime(x: number): number | null
}

function buildEntry(series: ISeriesApi<'Candlestick'>, coords: ChartCoordinates): ChartTestEntry {
  return {
    priceToY: (p) => series.priceToCoordinate(p) ?? null,
    yToPrice: (y) => {
      const v = series.coordinateToPrice(y)
      return typeof v === 'number' ? v : null
    },
    timeToX: coords.timeToPx,
    xToTime: coords.pxToTime,
  }
}

/**
 * DEV 環境限定で `window.__chartTest` に座標変換 API を露出する(Playwright 用)。
 * production ビルドでは `import.meta.env.DEV` が false になりツリーシェイクで除去される。
 *
 * `timeframe` 1 つにつき 1 エントリ。Map に key で挿入し、unmount / chart 入替で削除する。
 * e2e helper は `apps/trade-trainer/frontend/tests/e2e/helpers/chart.ts` の `waitForChartTest` /
 * `priceToY` / `viewportY` がこの Map を読む前提なので、登録 / 削除タイミングを変えない。
 */
export function useChartTestExposure(
  timeframe: string,
  core: ChartCore | null,
  coords: ChartCoordinates,
): void {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!core) return
    const w = window as unknown as { __chartTest?: Map<string, ChartTestEntry> }
    w.__chartTest ??= new Map()
    w.__chartTest.set(timeframe, buildEntry(core.series, coords))
    return () => {
      w.__chartTest?.delete(timeframe)
    }
  }, [core, coords, timeframe])
}
