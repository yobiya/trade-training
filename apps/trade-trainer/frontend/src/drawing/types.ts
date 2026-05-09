import type { ReactNode } from 'react'
import type { Drawing, DrawingKind, OhlcBar } from '../api/types'

export type PointPx = { x: number; y: number }
export type Point = { price: number; time: number | null }

export type PointerPayload = {
  point: Point
  pointerPx: PointPx
}

/** 座標変換 + 参照用 API(hook から chart に注入)。 */
export interface ChartApi {
  priceToY(price: number): number | null
  yToPrice(y: number): number | null
  timeToX(time: number): number | null
  xToTime(x: number): number | null
  /** §5.1.6 LowerTfRangeOverlay 用: logical index を px x に変換。
   *  `timeScale.logicalToCoordinate` の薄いラッパ。範囲外 logical でも線形外挿で px を返す
   *  (TF 間 projection の唯一の px 変換 API。詳細は invariants.md I-12)。 */
  logicalToX(logical: number): number | null
  /** チャートのドラッグパンを有効/無効にする。Moving 状態中は false にして描画操作と干渉させない。 */
  setScrollEnabled(enabled: boolean): void
  /** §5.3 high_break / low_break 用: 表示中の bars 配列を取得する。
   *  - 作成時の bar snap(クリック点に最寄りのバー検出)
   *  - render 時のブレイク判定(選択バー以降の確定 close 探索)
   *  に使用する。bar 配列はチャートの barsRef を参照するため、advance 等で更新される。 */
  getBars(): OhlcBar[]
}

/** 描画の何に当たったか。 */
export type HitResult = {
  drawingId: number
  kind: DrawingKind
  part: 'body' | 'handle'
  handleIndex?: number
}

/** ツールごとの横断情報(hitTest / renderOverlay / 既定可視性)を保持する。 */
export interface ToolMetadata {
  kind: DrawingKind
  label: string
  icon: string
  /** 仕様書 §5.3 デフォルト表示範囲。null は「全時間足に表示」 */
  defaultVisibleTfs: string[] | null
  hitTest(drawing: Drawing, px: PointPx, api: ChartApi): HitResult | null
  /** SVG オーバーレイに描画する React ノードを返す。未定義の場合はライブラリ標準(createPriceLine 等)に委譲。 */
  renderOverlay?(drawing: Drawing, api: ChartApi): ReactNode
}

export type UpdateDrawingPatch = {
  data?: Record<string, unknown>
  label?: string | null
  visible_on_timeframes?: string[] | null
}

export type CreateDrawingBody = {
  kind: DrawingKind
  data: Record<string, unknown>
  label?: string | null
  timeframe?: string | null
  visible_on_timeframes?: string[] | null
}
