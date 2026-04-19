import type { DrawingMode, HitResult, ModeContext, PointerPayload } from '../types'
import { findHit } from '../tools/registry'
import { MovingLineMode } from './MovingLineMode'
import { MovingTrendlineBodyMode } from './MovingTrendlineBodyMode'
import { MovingTrendlineHandleMode } from './MovingTrendlineHandleMode'

/**
 * 何も進行していない待機状態。マウスホバーで描画にヒットしたらカーソルを変える、
 * クリックで適切な Moving モードに遷移する。
 */
export class IdleMode implements DrawingMode {
  readonly id = 'idle'
  private currentCursor: string = 'default'

  get cursor(): string { return this.currentCursor }

  onMouseMove(e: PointerPayload, ctx: ModeContext): void {
    const hit = findHit(ctx.drawings, e.pointerPx, ctx.chartApi)
    this.currentCursor = hit ? cursorForHit(hit) : 'default'
  }

  onMouseDown(e: PointerPayload, ctx: ModeContext): void {
    const hit = findHit(ctx.drawings, e.pointerPx, ctx.chartApi)
    if (!hit) return
    const next = buildMovingMode(hit, ctx, e)
    if (next) ctx.setMode(next)
  }
}

function cursorForHit(hit: HitResult): string {
  if (hit.kind === 'line') return 'ns-resize'
  if (hit.part === 'handle') return 'grab'
  return 'move'
}

function buildMovingMode(hit: HitResult, ctx: ModeContext, e: PointerPayload): DrawingMode | null {
  const drawing = ctx.drawings.find(d => d.id === hit.drawingId)
  if (!drawing) return null
  switch (hit.kind) {
    case 'line':
      return new MovingLineMode(drawing)
    case 'trendline':
      if (hit.part === 'handle' && hit.handleIndex !== undefined) {
        return new MovingTrendlineHandleMode(drawing, hit.handleIndex)
      }
      if (e.point.time === null) return null  // 時間外の body ドラッグは不可
      return new MovingTrendlineBodyMode(drawing, { t: e.point.time, price: e.point.price })
    // 将来: fibonacci / label
    default: return null
  }
}
