import type { DrawingMode, HitResult, ModeContext, PointerPayload } from '../types'
import { findHit } from '../tools/registry'
import { MovingLineMode } from './MovingLineMode'

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
    const next = buildMovingMode(hit, ctx)
    if (next) ctx.setMode(next)
  }
}

function cursorForHit(hit: HitResult): string {
  if (hit.kind === 'line') return 'ns-resize'
  if (hit.part === 'handle') return 'grab'
  return 'move'
}

function buildMovingMode(hit: HitResult, ctx: ModeContext): DrawingMode | null {
  const drawing = ctx.drawings.find(d => d.id === hit.drawingId)
  if (!drawing) return null
  switch (hit.kind) {
    case 'line': return new MovingLineMode(drawing)
    // 将来: trendline/fibonacci/label
    default: return null
  }
}
