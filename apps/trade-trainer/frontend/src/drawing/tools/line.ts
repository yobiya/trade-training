import type { Drawing } from '../../api/types'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'

// 水平線の y 方向当たり判定(px)
const HIT_TOLERANCE_PX = 6

export const lineTool: ToolMetadata = {
  kind: 'line',
  label: '水平線',
  icon: '➖',
  // 仕様書 §5.3: 水平線は全時間足表示(null = 既定で全 TF)
  defaultVisibleTfs: null,

  hitTest(drawing: Drawing, px: PointPx, api: ChartApi): HitResult | null {
    const price = Number(drawing.data.price)
    if (Number.isNaN(price)) return null
    const y = api.priceToY(price)
    if (y === null) return null
    if (Math.abs(px.y - y) > HIT_TOLERANCE_PX) return null
    return { drawingId: drawing.id, kind: 'line', part: 'body' }
  },

  // 水平線はライブラリ標準の createPriceLine を使うので SVG オーバーレイは不要
  renderOverlay: undefined,
}
