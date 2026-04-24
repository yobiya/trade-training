import type { Drawing } from '../../api/types'
import type { DrawingMode, ModeContext, PointerPayload } from '../types'
import { waveLabelTool } from '../tools/wave_label'
import { IdleMode } from './IdleMode'

/**
 * 波動ラベル(1-5)を 1 クリックで配置するモード(仕様書 §16 Phase 2b 波動ラベリング支援)。
 * ツールバーのボタンから wave 番号を受け取る。配置後は IdleMode に戻る。
 */
export class DrawingWaveLabelMode implements DrawingMode {
  readonly id = 'drawing-wave-label'
  readonly cursor = 'crosshair'

  readonly wave: 1 | 2 | 3 | 4 | 5
  private previewPoint: { t: number; price: number } | null = null

  constructor(wave: 1 | 2 | 3 | 4 | 5) {
    this.wave = wave
  }

  async onChartClick(e: PointerPayload, ctx: ModeContext): Promise<void> {
    if (e.point.time === null) return
    await ctx.createDrawing({
      kind: 'wave_label',
      data: { t: e.point.time, price: e.point.price, wave: this.wave },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: waveLabelTool.defaultVisibleTfs,
    })
    ctx.setMode(new IdleMode())
  }

  onMouseMove(e: PointerPayload): void {
    if (e.point.time === null) return
    this.previewPoint = { t: e.point.time, price: e.point.price }
  }

  onEscape(ctx: ModeContext): void {
    ctx.setMode(new IdleMode())
  }

  getPreview(): Drawing | null {
    if (!this.previewPoint) return null
    return {
      id: -1,
      session_id: '',
      symbol: null,
      kind: 'wave_label',
      data: { t: this.previewPoint.t, price: this.previewPoint.price, wave: this.wave },
      label: null,
      timeframe: null,
      visible_on_timeframes: null,
    }
  }
}
