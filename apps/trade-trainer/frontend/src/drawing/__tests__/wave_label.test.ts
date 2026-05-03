import { describe, it, expect } from 'vitest'
import { nextWave, isWaveValue, getWaveLabelData, waveLabelTool, WAVE_VALUES } from '../tools/wave_label'
import type { Drawing } from '../../api/types'
import type { ChartApi } from '../types'

function makeDrawing(data: Record<string, unknown>): Drawing {
  return {
    id: 10,
    session_id: 'sess',
    symbol: null,
    kind: 'wave_label',
    data,
    label: null,
    timeframe: 'M5',
    visible_on_timeframes: null,
  }
}

function makeApi(x: number | null, y: number | null): ChartApi {
  return {
    priceToY: () => y,
    yToPrice: () => null,
    timeToX: () => x,
    xToTime: () => null,
    logicalToX: () => null,
    setScrollEnabled: () => {},
  }
}

// ---------------------------------------------------------------------------
// isWaveValue
// ---------------------------------------------------------------------------

describe('isWaveValue', () => {
  it.each(WAVE_VALUES)('"%s" → true', (v) => {
    expect(isWaveValue(v)).toBe(true)
  })

  it.each(['0', '6', 'a', 'b', 'c', 'D', '', 42, null, undefined])(
    '"%s" → false',
    (v) => {
      expect(isWaveValue(v)).toBe(false)
    },
  )
})

// ---------------------------------------------------------------------------
// nextWave
// ---------------------------------------------------------------------------

describe('nextWave', () => {
  it.each([
    ['1', '2'],
    ['2', '3'],
    ['3', '4'],
    ['4', '5'],
    ['5', null],
    ['A', 'B'],
    ['B', 'C'],
    ['C', null],
  ] as const)('nextWave(%s) = %s', (wave, expected) => {
    expect(nextWave(wave)).toBe(expected)
  })

  it('推進波と補正波はチェーンを跨がない(5 → null)', () => {
    expect(nextWave('5')).toBeNull()
  })

  it('補正波終端(C → null)', () => {
    expect(nextWave('C')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getWaveLabelData
// ---------------------------------------------------------------------------

describe('getWaveLabelData', () => {
  it('正常データ → WaveLabelData を返す', () => {
    const d = makeDrawing({ t: 1000, price: 150.5, wave: '3' })
    expect(getWaveLabelData(d)).toEqual({ t: 1000, price: 150.5, wave: '3' })
  })

  it('wave が無効 → null', () => {
    const d = makeDrawing({ t: 1000, price: 150.5, wave: 'X' })
    expect(getWaveLabelData(d)).toBeNull()
  })

  it('t が非数値 → null', () => {
    const d = makeDrawing({ t: 'not-a-number', price: 150.5, wave: '1' })
    expect(getWaveLabelData(d)).toBeNull()
  })

  it('price が非数値 → null', () => {
    const d = makeDrawing({ t: 1000, price: null, wave: '1' })
    expect(getWaveLabelData(d)).toBeNull()
  })

  it('全フィールド欠損 → null', () => {
    const d = makeDrawing({})
    expect(getWaveLabelData(d)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// waveLabelTool.hitTest
// ---------------------------------------------------------------------------

describe('waveLabelTool.hitTest', () => {
  const d = makeDrawing({ t: 1000, price: 100, wave: '2' })

  it('ラベル中心 → hit (body)', () => {
    const api = makeApi(50, 50)
    const result = waveLabelTool.hitTest(d, { x: 50, y: 50 }, api)
    expect(result).toEqual({ drawingId: 10, kind: 'wave_label', part: 'body' })
  })

  it('HIT_RADIUS_PX(12) 以内 → hit', () => {
    const api = makeApi(50, 50)
    // distance = sqrt(64+64) ≈ 11.3 ≤ 12
    const result = waveLabelTool.hitTest(d, { x: 58, y: 58 }, api)
    expect(result).not.toBeNull()
  })

  it('HIT_RADIUS_PX(12) 超 → miss', () => {
    const api = makeApi(50, 50)
    // distance = sqrt(100+100) ≈ 14.1 > 12
    const result = waveLabelTool.hitTest(d, { x: 60, y: 60 }, api)
    expect(result).toBeNull()
  })

  it('timeToX が null → miss', () => {
    const api = makeApi(null, 50)
    expect(waveLabelTool.hitTest(d, { x: 50, y: 50 }, api)).toBeNull()
  })

  it('priceToY が null → miss', () => {
    const api = makeApi(50, null)
    expect(waveLabelTool.hitTest(d, { x: 50, y: 50 }, api)).toBeNull()
  })

  it('描画データ不正 → miss', () => {
    const bad = makeDrawing({ t: 'bad', price: 100, wave: '1' })
    const api = makeApi(50, 50)
    expect(waveLabelTool.hitTest(bad, { x: 50, y: 50 }, api)).toBeNull()
  })
})
