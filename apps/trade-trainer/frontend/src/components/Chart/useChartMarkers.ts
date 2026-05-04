import { useEffect } from 'react'
import type { SeriesMarker, Time } from 'lightweight-charts'
import type { ChartCore } from './useChartInstance'
import type { ChartMarker } from './types'

/**
 * §5.5.4 マーカーは `setMarkers([])` でクリア + 一括上書き(差分管理は不要)。
 * バー時刻が `bars` に厳密一致しないと描画されないので、入力側で `nearestBarTime` を通す。
 */
export function useChartMarkers(
  core: ChartCore | null,
  markers: ChartMarker[] | undefined,
): void {
  useEffect(() => {
    if (!core) return
    const next: SeriesMarker<Time>[] = (markers ?? []).map(m => ({
      time: m.time as Time,
      position: m.position,
      shape: m.shape,
      color: m.color,
      text: m.text,
    }))
    core.series.setMarkers(next)
  }, [core, markers])
}
