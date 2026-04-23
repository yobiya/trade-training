import type { Drawing } from '../../api/types'
import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { IdleMode } from './IdleMode'
import { trendlineTool } from '../tools/trendline'

type PP = { t: number; price: number }

/**
 * トレンドラインを引くモード。
 * 1 クリック目で始点を置き、2 クリック目で終点を確定して IdleMode に戻る。
 * 1 クリック後はマウス移動でプレビュー線を更新する。
 */
export class DrawingTrendlineMode implements DrawingMode {
  readonly id = 'drawing-trendline'
  readonly cursor = 'crosshair'

  private firstPoint: PP | null = null
  private currentPoint: PP | null = null

  async onChartClick(e: PointerPayload, ctx: ModeContext): Promise<void> {
    if (e.point.time === null) return
    const p: PP = { t: e.point.time, price: e.point.price }
    if (this.firstPoint === null) {
      this.firstPoint = p
      this.currentPoint = p
      return
    }
    await ctx.createDrawing({
      kind: 'trendline',
      data: { points: [this.firstPoint, p] },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: trendlineTool.defaultVisibleTfs,
    })
    ctx.setMode(new IdleMode())
  }

  onMouseMove(e: PointerPayload): void {
    if (this.firstPoint === null || e.point.time === null) return
    this.currentPoint = { t: e.point.time, price: e.point.price }
  }

  onEscape(ctx: ModeContext): void {
    ctx.setMode(new IdleMode())
  }

  getPreview(): Drawing | null {
    if (this.firstPoint === null || this.currentPoint === null) return null
    return {
      id: -1,
      session_id: '',
      symbol: null,
      kind: 'trendline',
      data: { points: [this.firstPoint, this.currentPoint] },
      label: null,
      timeframe: null,
      visible_on_timeframes: null,
    }
  }
}
