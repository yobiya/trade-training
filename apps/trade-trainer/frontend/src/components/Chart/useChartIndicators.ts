import { useEffect, useRef } from 'react'
import type { ISeriesApi, Time } from 'lightweight-charts'
import type { OhlcBar } from '../../api/client'
import { INDICATORS } from '../../indicators/registry'
import type { IndicatorConfig } from '../../indicators/types'
import type { ChartCore } from './useChartInstance'

const RSI_SCALE_ID = 'rsi-pane'

/**
 * §5.2 インジケーターの差分管理。
 * - overlay: ローソク足と同じ右側価格軸に重ねる
 * - subpanel: `RSI_SCALE_ID` で別スケールを作り、下 25% に表示
 *
 * lightweight-charts v4 の priceScale はいずれかの系列が参照したときに生成されるため、
 * 順序は「系列追加 / 更新 → スケール設定」を維持する。
 *
 * Chart instance のライフサイクル(StrictMode 含む)が変わるときは保持中の line series ハンドルと
 * `rsiPaneConfiguredRef` を破棄する(次の chart に対して stale handle で `removeSeries` しないため)。
 */
export function useChartIndicators(
  core: ChartCore | null,
  indicators: IndicatorConfig[] | undefined,
  bars: OhlcBar[],
): void {
  const seriesMapRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const rsiPaneConfiguredRef = useRef(false)

  useEffect(() => {
    return () => {
      seriesMapRef.current.clear()
      rsiPaneConfiguredRef.current = false
    }
  }, [core])

  useEffect(() => {
    if (!core) return
    const { chart } = core
    const seriesMap = seriesMapRef.current
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
      if (!spec) continue  // 旧バージョンの type が state に残っている場合の防御
      const data = spec.compute(bars, ind.params).map(p => ({
        time: p.time as Time,
        value: p.value,
      }))
      const lineWidth = ind.width ?? 1
      let s = seriesMap.get(ind.key)
      if (!s) {
        s = chart.addLineSeries({
          color: ind.color,
          lineWidth,
          priceScaleId: spec.placement === 'subpanel' ? RSI_SCALE_ID : 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        })
        seriesMap.set(ind.key, s)
      } else {
        s.applyOptions({ color: ind.color, lineWidth })
      }
      s.setData(data)
    }

    // 系列追加後にスケールマージン構成
    const hasSubpanel = next.some(i => INDICATORS[i.type]?.placement === 'subpanel')
    if (hasSubpanel) {
      chart.priceScale(RSI_SCALE_ID).applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
        borderVisible: false,
      })
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } })
      rsiPaneConfiguredRef.current = true
    } else if (rsiPaneConfiguredRef.current) {
      // RSI 解除時は createChart 既定値に戻す
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.05 } })
      rsiPaneConfiguredRef.current = false
    }
  }, [core, indicators, bars])
}
