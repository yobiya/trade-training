import type { DrawingKind } from '../../api/types'
import type { DrawingMode } from '../types'
import { DrawingFibonacciMode } from './DrawingFibonacciMode'
import { DrawingLineMode } from './DrawingLineMode'
import { DrawingTrendlineMode } from './DrawingTrendlineMode'
import { IdleMode } from './IdleMode'

export { IdleMode } from './IdleMode'
export { DrawingLineMode } from './DrawingLineMode'
export { MovingLineMode } from './MovingLineMode'
export { DrawingTrendlineMode } from './DrawingTrendlineMode'
export { MovingTrendlineBodyMode } from './MovingTrendlineBodyMode'
export { MovingTrendlineHandleMode } from './MovingTrendlineHandleMode'
export { DrawingFibonacciMode } from './DrawingFibonacciMode'
export { MovingFibonacciBodyMode } from './MovingFibonacciBodyMode'
export { MovingFibonacciHandleMode } from './MovingFibonacciHandleMode'

/**
 * ツール選択に対応する Drawing*Mode を生成する。未対応ツールは IdleMode のまま。
 */
export function toolStartMode(tool: DrawingKind | null): DrawingMode {
  if (tool === null) return new IdleMode()
  switch (tool) {
    case 'line': return new DrawingLineMode()
    case 'trendline': return new DrawingTrendlineMode()
    case 'fibonacci': return new DrawingFibonacciMode()
    default: return new IdleMode()
  }
}
