import type { ChartApi } from '../../drawing/types'

/** §1.2 Chart に渡す価格水平線。`id` で差分管理する。 */
export type PriceLine = {
  id: string | number
  price: number
  label?: string
  color?: string
}

/** §5.5.4 エントリー / 決済の縦マーカー(エントリー TF のみ表示)。 */
export type ChartMarker = {
  /** バー時刻に丸めた Unix 秒(`SeriesMarker.time` が要求する) */
  time: number
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown'
  color: string
  text?: string
}

/**
 * §1.3 ref 経由で外部に公開する命令的 API。
 *
 * 各メンバの副作用 / null 返却条件 / 呼び出し制約は frontend-chart.md §1.3 / §1.4 を参照。
 */
export type ChartHandle = {
  api: ChartApi
  containerEl: HTMLDivElement | null
  /** チャートの再描画が必要なタイミング(時間軸変化・リサイズ等)でコールバックを呼ぶ。 */
  subscribeRedraw: (cb: () => void) => () => void
  /** §5.1.2 クロスヘア同期(命令的): 他チャートからの (time, price) を受け取り setCrosshairPosition を呼ぶ。 */
  setCrosshair: (time: number | null, price: number | null) => void
  /** §5.1.2 クロスヘア同期(購読): ユーザー操作によるクロスヘア移動を (time, price) で通知する。 */
  subscribeUserCrosshair: (cb: (time: number | null, price: number | null) => void) => () => void
  /** §5.1.6 LowerTfRangeOverlay 用: 自 Chart の visible logical range を返す。 */
  getVisibleLogicalRange: () => { from: number; to: number } | null
}
