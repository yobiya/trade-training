import type { Drawing } from '../api/types'

/**
 * 仕様書 §5.3: 描画が指定 TF で表示されるかを判定する。
 * - visible_on_timeframes が指定されていればその配列に従う
 * - 水平線・縦線・トレンドライン・チャネルは既定で全 TF 表示
 * - フィボナッチ・高値ブレイク・安値ブレイク・波動ラベルは作成 TF でのみ表示
 *   (high/low が TF 依存のため、ブレイク系は作成 TF のみが妥当)
 */
export function isDrawingVisibleOnTf(d: Drawing, tf: string): boolean {
  if (d.visible_on_timeframes) return d.visible_on_timeframes.includes(tf)
  if (d.kind === 'line' || d.kind === 'vline' || d.kind === 'trendline' || d.kind === 'channel') return true
  return d.timeframe === tf
}
