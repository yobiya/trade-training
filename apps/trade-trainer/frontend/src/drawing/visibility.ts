import type { Drawing } from '../api/types'

/**
 * 仕様書 §5.3: 描画が指定 TF で表示されるかを判定する。
 * - visible_on_timeframes が指定されていればその配列に従う
 * - 水平線・トレンドラインは既定で全 TF 表示
 * - フィボナッチなどその他は作成 TF でのみ表示
 */
export function isDrawingVisibleOnTf(d: Drawing, tf: string): boolean {
  if (d.visible_on_timeframes) return d.visible_on_timeframes.includes(tf)
  if (d.kind === 'line' || d.kind === 'trendline') return true
  return d.timeframe === tf
}
