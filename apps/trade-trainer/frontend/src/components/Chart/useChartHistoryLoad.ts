import { useEffect, useRef } from 'react'
import type { LogicalRange } from 'lightweight-charts'
import type { OhlcBar } from '../../api/client'
import type { ChartCore } from './useChartInstance'

/** 可視範囲の `range.from` がこの値より小さくなったら追加 history を要求する。 */
const LOAD_MORE_THRESHOLD = 5

/**
 * §4.1 / §7.1 visible logical range の left edge 検出のみを担う。
 *
 * `subscribeVisibleLogicalRangeChange` は **loadMoreHistory のトリガー専用** に使う(§7.1)。
 * 過去 ver で memory への書き戻しに使っていた経路は撤廃済み(visibleBarsMemory 撤廃)。
 *
 * `onNeedMoreHistory` は ref で参照するため、prop 変化で effect は再 attach しない。
 * 二重発火防止は呼び出し側(`useCharts.loadMoreHistory`)に委ねる。
 */
export function useChartHistoryLoad(
  core: ChartCore | null,
  barsRef: React.RefObject<OhlcBar[]>,
  onNeedMoreHistory: ((earliestUnix: number) => void) | undefined,
): void {
  const cbRef = useRef(onNeedMoreHistory)
  cbRef.current = onNeedMoreHistory

  useEffect(() => {
    if (!core) return
    const { chart } = core
    const handler = (range: LogicalRange | null) => {
      if (!range) return
      if (range.from < LOAD_MORE_THRESHOLD) {
        const oldest = barsRef.current?.[0]
        if (oldest) cbRef.current?.(oldest.t)
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(handler)
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
    }
  }, [core, barsRef])
}
