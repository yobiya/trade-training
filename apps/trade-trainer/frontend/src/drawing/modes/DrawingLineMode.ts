import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { IdleMode } from './IdleMode'
import { lineTool } from '../tools/line'

/**
 * 水平線を引くモード。1 クリックで作成して Idle に戻る。
 */
export class DrawingLineMode implements DrawingMode {
  readonly id = 'drawing-line'
  readonly cursor = 'crosshair'

  async onChartClick(e: PointerPayload, ctx: ModeContext): Promise<void> {
    await ctx.createDrawing({
      kind: 'line',
      data: { price: e.point.price },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: lineTool.defaultVisibleTfs,
    })
    ctx.setMode(new IdleMode())
  }

  onEscape(ctx: ModeContext): void {
    ctx.setMode(new IdleMode())
  }
}
