import { useEffect } from 'react'
import type { ChartCore } from './useChartInstance'

/**
 * 価格スケール / priceLine ラベルの精度を MT5 `symbol_info.digits` に合わせる。
 * digits が undefined のときは LWC 既定値のまま。
 */
export function useChartPriceFormat(core: ChartCore | null, digits: number | undefined): void {
  useEffect(() => {
    if (!core || digits == null) return
    core.series.applyOptions({
      priceFormat: {
        type: 'price',
        precision: digits,
        minMove: Math.pow(10, -digits),
      },
    })
  }, [core, digits])
}
