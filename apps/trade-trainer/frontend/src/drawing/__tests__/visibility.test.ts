import { describe, it, expect } from 'vitest'
import { isDrawingVisibleOnTf } from '../visibility'
import type { Drawing } from '../../api/types'

function makeDrawing(overrides: Partial<Drawing>): Drawing {
  return {
    id: 1,
    session_id: 'sess1',
    symbol: null,
    kind: 'line',
    data: {},
    label: null,
    timeframe: null,
    visible_on_timeframes: null,
    ...overrides,
  }
}

describe('isDrawingVisibleOnTf', () => {
  describe('visible_on_timeframes が指定されている場合はその配列に従う', () => {
    it('配列に含まれる TF → true', () => {
      const d = makeDrawing({ visible_on_timeframes: ['M5', 'H1'] })
      expect(isDrawingVisibleOnTf(d, 'M5')).toBe(true)
      expect(isDrawingVisibleOnTf(d, 'H1')).toBe(true)
    })

    it('配列に含まれない TF → false', () => {
      const d = makeDrawing({ visible_on_timeframes: ['M5', 'H1'] })
      expect(isDrawingVisibleOnTf(d, 'H4')).toBe(false)
    })

    it('kind が line でも配列外 TF → false', () => {
      const d = makeDrawing({ kind: 'line', visible_on_timeframes: ['M5'] })
      expect(isDrawingVisibleOnTf(d, 'H1')).toBe(false)
    })
  })

  describe('visible_on_timeframes が null のとき kind 既定', () => {
    it('line: 全 TF で true', () => {
      const d = makeDrawing({ kind: 'line' })
      expect(isDrawingVisibleOnTf(d, 'M5')).toBe(true)
      expect(isDrawingVisibleOnTf(d, 'H1')).toBe(true)
      expect(isDrawingVisibleOnTf(d, 'H4')).toBe(true)
      expect(isDrawingVisibleOnTf(d, 'D1')).toBe(true)
    })

    it('trendline: 全 TF で true', () => {
      const d = makeDrawing({ kind: 'trendline' })
      expect(isDrawingVisibleOnTf(d, 'M5')).toBe(true)
      expect(isDrawingVisibleOnTf(d, 'D1')).toBe(true)
    })

    it('fibonacci: 作成 TF のみ true', () => {
      const d = makeDrawing({ kind: 'fibonacci', timeframe: 'H1' })
      expect(isDrawingVisibleOnTf(d, 'H1')).toBe(true)
      expect(isDrawingVisibleOnTf(d, 'M5')).toBe(false)
      expect(isDrawingVisibleOnTf(d, 'H4')).toBe(false)
    })

    it('wave_label: 作成 TF のみ true', () => {
      const d = makeDrawing({ kind: 'wave_label', timeframe: 'M5' })
      expect(isDrawingVisibleOnTf(d, 'M5')).toBe(true)
      expect(isDrawingVisibleOnTf(d, 'H1')).toBe(false)
    })

    it('fibonacci: timeframe null → どの TF も false', () => {
      const d = makeDrawing({ kind: 'fibonacci', timeframe: null })
      expect(isDrawingVisibleOnTf(d, 'M5')).toBe(false)
    })
  })
})
