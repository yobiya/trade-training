import { useMemo } from 'react'
import type { OhlcBar, TradeResponse } from '../api/client'
import type { ChartMarker } from '../components/Chart'
import { nearestBarTime } from '../utils/bars'

/**
 * §5.5.4: Trade.entry_tf チャートに渡すエントリー / 決済の三角マーカーを導出する。
 *
 * - エントリー: buy なら下向き三角(belowBar / arrowUp、緑)、sell なら逆
 * - 決済(exit_time != null): エントリーと反対向きの三角。利益なら緑、損失なら赤
 *
 * `displayTrade.entry_tf` が空のときは `'M5'` にフォールバック。bars 未取得時は空配列。
 */
export function useEntryMarkers(
  displayTrade: TradeResponse | null,
  barsByTf: Record<string, OhlcBar[]>,
): ChartMarker[] {
  return useMemo<ChartMarker[]>(() => {
    if (!displayTrade) return []
    const tradeTf = displayTrade.entry_tf || 'M5'
    const entryBars = barsByTf[tradeTf] ?? []
    if (entryBars.length === 0) return []

    const out: ChartMarker[] = []
    const entryUnix = Math.floor(new Date(displayTrade.entry_time).getTime() / 1000)
    const entryNearest = nearestBarTime(entryBars, entryUnix)
    if (entryNearest != null) {
      const isBuy = displayTrade.direction === 'buy'
      out.push({
        time: entryNearest,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#26a69a' : '#ef5350',
        text: `${isBuy ? 'BUY' : 'SELL'} ${displayTrade.entry_price}`,
      })
    }

    if (displayTrade.exit_time != null && displayTrade.exit_price != null) {
      const exitUnix = Math.floor(new Date(displayTrade.exit_time).getTime() / 1000)
      const exitNearest = nearestBarTime(entryBars, exitUnix)
      if (exitNearest != null) {
        const isProfit = (displayTrade.pips_pnl ?? 0) >= 0
        const isBuy = displayTrade.direction === 'buy'
        out.push({
          time: exitNearest,
          position: isBuy ? 'aboveBar' : 'belowBar',
          shape: isBuy ? 'arrowDown' : 'arrowUp',
          color: isProfit ? '#26a69a' : '#ef5350',
          text: `Exit ${displayTrade.exit_price}`,
        })
      }
    }
    return out
  }, [displayTrade, barsByTf])
}
