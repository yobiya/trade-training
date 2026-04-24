import type { Drawing } from '../../api/types'
import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { getWaveLabelData } from '../tools/wave_label'
import { IdleMode } from './IdleMode'

/**
 * 波動ラベルをドラッグで任意の位置に移動するモード。
 * マウスアップで t / price を確定し IdleMode に戻る。
 */
export class MovingWaveLabelMode implements DrawingMode {
  readonly id = 'moving-wave-label'
  readonly cursor = 'move'

  private readonly original: Drawing
  private preview: Drawing

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
    if (e.point.time === null) return
    const d = getWaveLabelData(this.original)
    if (!d) return
    this.preview = {
      ...this.original,
      data: { ...d, t: e.point.time, price: e.point.price },
    }
  }

  async onMouseUp(e: PointerPayload, ctx: ModeContext): Promise<void> {
    if (e.point.time !== null && this.preview !== this.original) {
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
