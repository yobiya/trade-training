import type { Drawing } from '../../api/types'
import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { IdleMode } from './IdleMode'
import { getTrendlinePoints } from '../tools/trendline'

/**
 * トレンドラインの片方の端点を移動するモード。もう片方は固定。
 */
export class MovingTrendlineHandleMode implements DrawingMode {
  readonly id = 'moving-trendline-handle'
  readonly cursor = 'grabbing'

  private readonly original: Drawing
  private preview: Drawing
  private readonly handleIndex: number

  constructor(target: Drawing, handleIndex: number) {
    this.original = target
    this.preview = target
    this.handleIndex = handleIndex
  }

  onEnter(ctx: ModeContext): void {
    ctx.chartApi.setScrollEnabled(false)
  }
  onExit(ctx: ModeContext): void {
    ctx.chartApi.setScrollEnabled(true)
  }

  onMouseMove(e: PointerPayload): void {
    if (e.point.time === null) return
    const orig = getTrendlinePoints(this.original)
    if (!orig) return
    const moved = e.point
    const newPoints = orig.map((p, i) =>
      i === this.handleIndex ? { t: moved.time!, price: moved.price } : p,
    )
    this.preview = { ...this.original, data: { points: newPoints } }
  }

  async onMouseUp(_e: PointerPayload, ctx: ModeContext): Promise<void> {
    if (this.preview !== this.original) {
      await ctx.updateDrawing(this.original.id, { data: this.preview.data })
    }
    ctx.setMode(new IdleMode())
  }

  onEscape(ctx: ModeContext): void {
    ctx.setMode(new IdleMode())
  }

  getPreview(): Drawing | null {
    return this.preview
  }
}
