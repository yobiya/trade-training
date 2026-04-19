import type { Drawing } from '../../api/types'
import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { IdleMode } from './IdleMode'

/**
 * 水平線を y 方向ドラッグで移動するモード。
 * マウスアップで価格を確定し Idle に戻る。ESC でキャンセル。
 */
export class MovingLineMode implements DrawingMode {
  readonly id = 'moving-line'
  readonly cursor = 'ns-resize'

  private preview: Drawing
  private readonly original: Drawing

  constructor(target: Drawing) {
    this.original = target
    this.preview = target
  }

  onEnter(ctx: ModeContext): void {
    ctx.chartApi.setScrollEnabled(false)
  }
  onExit(ctx: ModeContext): void {
    ctx.chartApi.setScrollEnabled(true)
  }

  onMouseMove(e: PointerPayload): void {
    this.preview = {
      ...this.original,
      data: { ...this.original.data, price: e.point.price },
    }
  }

  async onMouseUp(e: PointerPayload, ctx: ModeContext): Promise<void> {
    // 表示中の preview と保存値を一致させるため、ここでは丸めない
    // (coordinateToPrice の精度はピクセル解像度に依存するため、これで十分)
    await ctx.updateDrawing(this.original.id, { data: { price: e.point.price } })
    ctx.setMode(new IdleMode())
  }

  onEscape(ctx: ModeContext): void {
    ctx.setMode(new IdleMode())
  }

  getPreview(): Drawing | null {
    return this.preview
  }
}
