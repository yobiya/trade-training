import type { Drawing, DrawingKind } from '../../api/types'
import type { ChartApi, HitResult, PointPx, ToolMetadata } from '../types'
import { channelTool } from './channel'
import { fibonacciTool } from './fibonacci'
import { highBreakTool } from './high_break'
import { lineTool } from './line'
import { lowBreakTool } from './low_break'
import { trendlineTool } from './trendline'
import { vlineTool } from './vline'
import { waveLabelTool } from './wave_label'

/**
 * ツール横断情報のレジストリ(仕様書 §5.3)。
 * 新ツール追加時はここにエントリを追加する。既存エントリには触らない。
 */
export const TOOLS: Record<DrawingKind, ToolMetadata | undefined> = {
  line: lineTool,
  vline: vlineTool,
  trendline: trendlineTool,
  channel: channelTool,
  fibonacci: fibonacciTool,
  wave_label: waveLabelTool,
  high_break: highBreakTool,
  low_break: lowBreakTool,
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
