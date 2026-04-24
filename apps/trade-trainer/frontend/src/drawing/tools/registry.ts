import type { Drawing, DrawingKind } from '../../api/types'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'
import { fibonacciTool } from './fibonacci'
import { lineTool } from './line'
import { trendlineTool } from './trendline'
import { waveLabelTool } from './wave_label'

/**
 * ツール横断情報のレジストリ(仕様書 §5.3)。
 * 新ツール追加時はここにエントリを追加する。既存エントリには触らない。
 */
export const TOOLS: Record<DrawingKind, ToolMetadata | undefined> = {
  line: lineTool,
  trendline: trendlineTool,
  fibonacci: fibonacciTool,
  wave_label: waveLabelTool,
}

export function findHit(
  drawings: Drawing[],
  px: PointPx,
  api: ChartApi,
): HitResult | null {
  // 後で描画されたものほど手前にあるとみなし、後ろから検索
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i]
    const tool = TOOLS[d.kind]
    if (!tool) continue
    const hit = tool.hitTest(d, px, api)
    if (hit) return hit
  }
  return null
}
