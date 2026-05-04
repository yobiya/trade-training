import type { Drawing } from '../api/client'
import type { PriceLine } from '../components/Chart'
import { getTimeframeColor } from '../constants'
import { isDrawingVisibleOnTf } from '../drawing/visibility'

/** §5.5: phase に応じて優先順を決めた、表示用 Trade スナップショット */
export type TradeForDisplay = {
  entry_price: number
  sl: number | null
  tp: number | null
  exit_price: number | null
  pips_pnl: number | null
} | null

function fmtPrice(p: number, digits: number): string {
  return p.toFixed(digits)
}

/**
 * 描画 (Drawing[]) / エントリー draft / Trade を 1 セットの PriceLine[] に集約する。
 *
 * - Drawing は `kind === 'line'` かつ `isDrawingVisibleOnTf` を満たすものだけ
 * - `preview` がある drawing はそのフレームに preview 値を上書き表示
 * - `entryDraft.sl / tp` は全 TF に SL / TP の組み立て中ラインを足す(§7.4)
 * - Trade があれば Entry / SL / TP / Exit ラインを足す(§5.5)
 * - `tradeLinePreview` がある場合は Trade.sl / tp を drag preview で上書きする(§5.5.5)
 */
export function priceLinesForTf(
  drawings: Drawing[],
  tf: string,
  preview: Drawing | null,
  entryDraft: { sl: number | null; tp: number | null },
  trade: TradeForDisplay,
  digits: number,
  tradeLinePreview: { handle: 'sl' | 'tp'; price: number } | null,
): PriceLine[] {
  const lines: PriceLine[] = drawings
    .filter(d => d.kind === 'line' && isDrawingVisibleOnTf(d, tf))
    .map(d => {
      const previewMatch = preview?.id === d.id ? preview : null
      return {
        id: d.id,
        price: Number(previewMatch?.data.price ?? d.data.price),
        label: d.label ?? undefined,
        color: getTimeframeColor(d.timeframe),
      }
    })

  if (entryDraft.sl != null) {
    lines.push({ id: -1001, price: entryDraft.sl, label: 'SL', color: '#ff5555' })
  }
  if (entryDraft.tp != null) {
    lines.push({ id: -1002, price: entryDraft.tp, label: 'TP', color: '#58a6ff' })
  }

  if (trade) {
    lines.push({
      id: -2001,
      price: trade.entry_price,
      label: `Entry @ ${fmtPrice(trade.entry_price, digits)}`,
      color: '#e3b341',
    })
    const slDisplay = tradeLinePreview?.handle === 'sl' ? tradeLinePreview.price : trade.sl
    const tpDisplay = tradeLinePreview?.handle === 'tp' ? tradeLinePreview.price : trade.tp
    if (slDisplay != null) {
      lines.push({
        id: -2002,
        price: slDisplay,
        label: `SL @ ${fmtPrice(slDisplay, digits)}`,
        color: '#ff5555',
      })
    }
    if (tpDisplay != null) {
      lines.push({
        id: -2003,
        price: tpDisplay,
        label: `TP @ ${fmtPrice(tpDisplay, digits)}`,
        color: '#58a6ff',
      })
    }
    if (trade.exit_price != null) {
      const exitColor = (trade.pips_pnl ?? 0) >= 0 ? '#26a69a' : '#ef5350'
      lines.push({
        id: -2004,
        price: trade.exit_price,
        label: `Exit @ ${fmtPrice(trade.exit_price, digits)}`,
        color: exitColor,
      })
    }
  }
  return lines
}
