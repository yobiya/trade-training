import type { ReactNode } from 'react'
import type { Drawing, DrawingKind } from '../api/types'

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
  /** チャートのドラッグパンを有効/無効にする。Moving 状態中は false にして描画操作と干渉させない。 */
  setScrollEnabled(enabled: boolean): void
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
