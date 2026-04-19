import type { Drawing } from '../../api/types'
import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { IdleMode } from './IdleMode'
import { getFibPoints } from '../tools/fibonacci'

/**
 * フィボナッチの片方の端点(100% または 0%)だけを移動するモード。
 * レベル線は自動的に追従する。
 */
export class MovingFibonacciHandleMode implements DrawingMode {
  readonly id = 'moving-fibonacci-handle'
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
    const orig = getFibPoints(this.original)
    if (!orig) return
    const newPoints = orig.map((p, i) =>
      i === this.handleIndex ? { t: e.point.time!, price: e.point.price } : p,
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
