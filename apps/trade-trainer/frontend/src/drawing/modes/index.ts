import type { DrawingKind } from '../../api/types'
import type { DrawingMode } from '../types'
import { DrawingLineMode } from './DrawingLineMode'
import { IdleMode } from './IdleMode'

export { IdleMode } from './IdleMode'
export { DrawingLineMode } from './DrawingLineMode'
export { MovingLineMode } from './MovingLineMode'

/**
 * ツール選択に対応する Drawing*Mode を生成する。未対応ツールは IdleMode のまま。
 */
export function toolStartMode(tool: DrawingKind | null): DrawingMode {
  if (tool === null) return new IdleMode()
  switch (tool) {
    case 'line': return new DrawingLineMode()
    // 将来: trendline, fibonacci, label
    default: return new IdleMode()
  }
}
