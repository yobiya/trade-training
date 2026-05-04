import { useEffect, useRef } from 'react'
import { LineStyle } from 'lightweight-charts'
import type { IPriceLine } from 'lightweight-charts'
import type { ChartCore } from './useChartInstance'
import type { PriceLine } from './types'

/**
 * priceLines の差分追加 / 削除 / `applyOptions` を行う。`id` をキーに既存ハンドルを再利用する。
 *
 * Chart instance のライフサイクル(StrictMode 含む)が変わるときは保持中の handle を破棄する。
 * チャート破棄後の `IPriceLine` ハンドルは無効になるため、次の Chart instance に対して
 * `removePriceLine(stale handle)` を呼ばないように `core` 変化で map をクリアする。
 */
export function useChartPriceLines(
  core: ChartCore | null,
  priceLines: PriceLine[] | undefined,
): void {
  const handlesRef = useRef<Map<string | number, IPriceLine>>(new Map())

  useEffect(() => {
    return () => {
      handlesRef.current.clear()
    }
  }, [core])

  useEffect(() => {
    if (!core) return
    const { series } = core
    const handles = handlesRef.current
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
  }, [core, priceLines])
}
