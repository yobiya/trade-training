import type { Drawing } from '../../api/types'
import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { IdleMode } from './IdleMode'
import { fibonacciTool } from '../tools/fibonacci'

type PP = { t: number; price: number }

/**
 * フィボナッチリトレースメントを引くモード。2 点クリックで作成する。
 * 1 クリック目で始点(100%)、2 クリック目で終点(0%)を確定。
 * マウス移動中はプレビュー線を表示する。
 */
export class DrawingFibonacciMode implements DrawingMode {
  readonly id = 'drawing-fibonacci'
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
      kind: 'fibonacci',
      data: { points: [this.firstPoint, p] },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: fibonacciTool.defaultVisibleTfs,
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
      kind: 'fibonacci',
      data: { points: [this.firstPoint, this.currentPoint] },
      label: null,
      timeframe: null,
      visible_on_timeframes: null,
    }
  }
}
