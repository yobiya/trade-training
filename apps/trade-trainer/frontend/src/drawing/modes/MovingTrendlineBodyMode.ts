import type { Drawing } from '../../api/types'
import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { IdleMode } from './IdleMode'
import { getTrendlinePoints } from '../tools/trendline'

type PP = { t: number; price: number }

/**
 * トレンドライン全体を平行移動するモード。
 * マウスダウン時のポインタ位置を基準にオフセットを計算し、両端点を平行移動する。
 */
export class MovingTrendlineBodyMode implements DrawingMode {
  readonly id = 'moving-trendline-body'
  readonly cursor = 'move'

  private readonly original: Drawing
  private preview: Drawing
  private readonly anchor: PP

  constructor(target: Drawing, anchor: PP) {
    this.original = target
    this.preview = target
    this.anchor = anchor
  }

  onEnter(ctx: ModeContext): void {
    ctx.chartApi.setScrollEnabled(false)
  }
  onExit(ctx: ModeContext): void {
    ctx.chartApi.setScrollEnabled(true)
  }

  onMouseMove(e: PointerPayload): void {
    if (e.point.time === null) return
    const dt = e.point.time - this.anchor.t
    const dp = e.point.price - this.anchor.price
    const orig = getTrendlinePoints(this.original)
    if (!orig) return
    this.preview = {
      ...this.original,
      data: { points: orig.map(p => ({ t: p.t + dt, price: p.price + dp })) },
    }
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
