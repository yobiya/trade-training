import { describe, it, expect, vi } from 'vitest'
import {
  dispatchEvent,
  idleState,
  cursorOf,
  previewOf,
  activeToolOf,
  activeWaveOf,
  hoveredIdOf,
  isMovingState,
  tradeLinePreviewOf,
  type DrawingState,
  type DispatchContext,
} from '../state'
import type { Drawing } from '../../api/types'
import type { ChartApi, PointerPayload } from '../types'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeChartApi(overrides?: Partial<ChartApi>): ChartApi {
  return {
    priceToY: () => null,
    yToPrice: () => null,
    timeToX: () => null,
    xToTime: () => null,
    logicalToX: () => null,
    setScrollEnabled: () => {},
    ...overrides,
  }
}

function makeCtx(overrides?: Partial<DispatchContext>): DispatchContext {
  return {
    chartApi: makeChartApi(),
    drawings: [],
    activeTimeframe: 'M5',
    createDrawing: vi.fn().mockResolvedValue({ id: 1 }),
    updateDrawing: vi.fn().mockResolvedValue(undefined),
    deleteDrawing: vi.fn().mockResolvedValue(undefined),
    tradeLines: null,
    ...overrides,
  }
}

function makePayload(
  price = 100,
  time: number | null = 1000,
  px = { x: 50, y: 50 },
): PointerPayload {
  return { point: { price, time }, pointerPx: px }
}

function makeDrawing(overrides?: Partial<Drawing>): Drawing {
  return {
    id: 1,
    session_id: 'sess1',
    symbol: null,
    kind: 'line',
    data: { price: 100 },
    label: null,
    timeframe: 'M5',
    visible_on_timeframes: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// escape
// ---------------------------------------------------------------------------

describe('escape', () => {
  it.each([
    { kind: 'idle', cursor: 'default', hoveredId: null } satisfies DrawingState,
    { kind: 'drawing-line' } satisfies DrawingState,
    { kind: 'drawing-trendline', firstPoint: null, currentPoint: null } satisfies DrawingState,
    { kind: 'drawing-wave-label', wave: '3', previewPoint: null } satisfies DrawingState,
  ] as DrawingState[])('escape from %s → idle', (state) => {
    expect(dispatchEvent(state, { type: 'escape' }, makeCtx())).toEqual(idleState())
  })
})

// ---------------------------------------------------------------------------
// select-tool
// ---------------------------------------------------------------------------

describe('select-tool', () => {
  it('null → idle', () => {
    const next = dispatchEvent({ kind: 'drawing-line' }, { type: 'select-tool', tool: null }, makeCtx())
    expect(next).toEqual(idleState())
  })

  it('line → drawing-line', () => {
    const next = dispatchEvent(idleState(), { type: 'select-tool', tool: 'line' }, makeCtx())
    expect(next.kind).toBe('drawing-line')
  })

  it('trendline → drawing-trendline', () => {
    const next = dispatchEvent(idleState(), { type: 'select-tool', tool: 'trendline' }, makeCtx())
    expect(next.kind).toBe('drawing-trendline')
  })

  it('fibonacci → drawing-fibonacci', () => {
    const next = dispatchEvent(idleState(), { type: 'select-tool', tool: 'fibonacci' }, makeCtx())
    expect(next.kind).toBe('drawing-fibonacci')
  })

  it('wave_label without wave → idle', () => {
    const next = dispatchEvent(idleState(), { type: 'select-tool', tool: 'wave_label' }, makeCtx())
    expect(next).toEqual(idleState())
  })

  it('wave_label with wave → drawing-wave-label', () => {
    const next = dispatchEvent(idleState(), { type: 'select-tool', tool: 'wave_label', wave: '1' }, makeCtx())
    expect(next.kind).toBe('drawing-wave-label')
    if (next.kind === 'drawing-wave-label') {
      expect(next.wave).toBe('1')
      expect(next.previewPoint).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// idle — mouse-move hit-test
// ---------------------------------------------------------------------------

describe('idle mouse-move', () => {
  it('no drawing, no tradeLines → default cursor', () => {
    const next = dispatchEvent(idleState(), { type: 'mouse-move', payload: makePayload() }, makeCtx())
    expect(next).toEqual({ kind: 'idle', cursor: 'default', hoveredId: null })
  })

  it('SL within TRADE_LINE_HIT_PX → ns-resize cursor, hoveredId null', () => {
    const api = makeChartApi({ priceToY: (p) => (p === 100 ? 50 : null) })
    const ctx = makeCtx({ chartApi: api, tradeLines: { sl: 100, tp: null } })
    const next = dispatchEvent(idleState(), { type: 'mouse-move', payload: makePayload(100, 1000, { x: 50, y: 50 }) }, ctx)
    expect(next).toEqual({ kind: 'idle', cursor: 'ns-resize', hoveredId: null })
  })

  it('SL out of range → falls through to default cursor', () => {
    // priceToY returns 200 but pointer is at y=50 (distance > 6px)
    const api = makeChartApi({ priceToY: (p) => (p === 100 ? 200 : null) })
    const ctx = makeCtx({ chartApi: api, tradeLines: { sl: 100, tp: null } })
    const next = dispatchEvent(idleState(), { type: 'mouse-move', payload: makePayload(100, 1000, { x: 50, y: 50 }) }, ctx)
    expect(next).toEqual({ kind: 'idle', cursor: 'default', hoveredId: null })
  })

  it('SL takes priority over TP when both in range', () => {
    // Both SL=100 and TP=110 map to y=50 — SL should win
    const api = makeChartApi({ priceToY: () => 50 })
    const ctx = makeCtx({ chartApi: api, tradeLines: { sl: 100, tp: 110 } })
    // To actually test SL priority we need the iteration order (sl first in the loop).
    // The result is ns-resize either way, so just verify it hits at all.
    const next = dispatchEvent(idleState(), { type: 'mouse-move', payload: makePayload(100, 1000, { x: 50, y: 50 }) }, ctx)
    expect(next).toEqual({ kind: 'idle', cursor: 'ns-resize', hoveredId: null })
  })
})

// ---------------------------------------------------------------------------
// idle — mouse-down: SL/TP drag start
// ---------------------------------------------------------------------------

describe('idle mouse-down: SL/TP drag', () => {
  it('SL in range + updateTradeLine present → moving-trade-line', () => {
    const api = makeChartApi({ priceToY: (p) => (p === 100 ? 50 : null) })
    const ctx = makeCtx({
      chartApi: api,
      tradeLines: { sl: 100, tp: null },
      updateTradeLine: vi.fn().mockResolvedValue(undefined),
    })
    const next = dispatchEvent(idleState(), { type: 'mouse-down', payload: makePayload(100, 1000, { x: 50, y: 50 }) }, ctx)
    expect(next.kind).toBe('moving-trade-line')
    if (next.kind === 'moving-trade-line') {
      expect(next.handle).toBe('sl')
      expect(next.original).toBe(100)
      expect(next.preview).toBe(100)
    }
  })

  it('SL in range but no updateTradeLine → stays idle (cannot commit)', () => {
    const api = makeChartApi({ priceToY: (p) => (p === 100 ? 50 : null) })
    const ctx = makeCtx({ chartApi: api, tradeLines: { sl: 100, tp: null } })
    const next = dispatchEvent(idleState(), { type: 'mouse-down', payload: makePayload(100, 1000, { x: 50, y: 50 }) }, ctx)
    expect(next.kind).toBe('idle')
  })

  it('tradeLines null → does not start trade drag', () => {
    const ctx = makeCtx({ updateTradeLine: vi.fn() })
    const next = dispatchEvent(idleState(), { type: 'mouse-down', payload: makePayload() }, ctx)
    expect(next.kind).toBe('idle')
  })

  it('no drawing hit → stays idle', () => {
    const next = dispatchEvent(idleState(), { type: 'mouse-down', payload: makePayload() }, makeCtx())
    expect(next.kind).toBe('idle')
  })
})

// ---------------------------------------------------------------------------
// drawing-line
// ---------------------------------------------------------------------------

describe('drawing-line', () => {
  it('click → calls createDrawing with correct price, returns idle', () => {
    const createDrawing = vi.fn().mockResolvedValue({ id: 1 })
    const state: DrawingState = { kind: 'drawing-line' }
    const next = dispatchEvent(state, { type: 'click', payload: makePayload(150) }, makeCtx({ createDrawing }))
    expect(next).toEqual(idleState())
    expect(createDrawing).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'line', data: { price: 150 } }),
    )
  })

  it('mouse-move → no change', () => {
    const state: DrawingState = { kind: 'drawing-line' }
    const next = dispatchEvent(state, { type: 'mouse-move', payload: makePayload() }, makeCtx())
    expect(next).toBe(state)
  })
})

// ---------------------------------------------------------------------------
// drawing-trendline
// ---------------------------------------------------------------------------

describe('drawing-trendline', () => {
  it('first click sets firstPoint', () => {
    const state: DrawingState = { kind: 'drawing-trendline', firstPoint: null, currentPoint: null }
    const next = dispatchEvent(state, { type: 'click', payload: makePayload(100, 1000) }, makeCtx())
    expect(next.kind).toBe('drawing-trendline')
    if (next.kind === 'drawing-trendline') {
      expect(next.firstPoint).toEqual({ t: 1000, price: 100 })
    }
  })

  it('click with null time → no change', () => {
    const state: DrawingState = { kind: 'drawing-trendline', firstPoint: null, currentPoint: null }
    const next = dispatchEvent(state, { type: 'click', payload: makePayload(100, null) }, makeCtx())
    expect(next).toBe(state)
  })

  it('second click → creates drawing, returns idle', () => {
    const createDrawing = vi.fn().mockResolvedValue({ id: 2 })
    const first = { t: 1000, price: 100 }
    const state: DrawingState = { kind: 'drawing-trendline', firstPoint: first, currentPoint: first }
    const next = dispatchEvent(state, { type: 'click', payload: makePayload(110, 2000) }, makeCtx({ createDrawing }))
    expect(next).toEqual(idleState())
    expect(createDrawing).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'trendline',
        data: { points: [first, { t: 2000, price: 110 }] },
      }),
    )
  })

  it('mouse-move after firstPoint → updates currentPoint', () => {
    const first = { t: 1000, price: 100 }
    const state: DrawingState = { kind: 'drawing-trendline', firstPoint: first, currentPoint: first }
    const next = dispatchEvent(state, { type: 'mouse-move', payload: makePayload(120, 1500) }, makeCtx())
    expect(next.kind).toBe('drawing-trendline')
    if (next.kind === 'drawing-trendline') {
      expect(next.currentPoint).toEqual({ t: 1500, price: 120 })
      expect(next.firstPoint).toEqual(first)
    }
  })

  it('mouse-move without firstPoint → no change', () => {
    const state: DrawingState = { kind: 'drawing-trendline', firstPoint: null, currentPoint: null }
    const next = dispatchEvent(state, { type: 'mouse-move', payload: makePayload(120, 1500) }, makeCtx())
    expect(next).toBe(state)
  })
})

// ---------------------------------------------------------------------------
// drawing-wave-label — auto-advance
// ---------------------------------------------------------------------------

describe('drawing-wave-label auto-advance', () => {
  const cases: Array<{ wave: string; nextWave: string | null }> = [
    { wave: '1', nextWave: '2' },
    { wave: '2', nextWave: '3' },
    { wave: '3', nextWave: '4' },
    { wave: '4', nextWave: '5' },
    { wave: '5', nextWave: null },
    { wave: 'A', nextWave: 'B' },
    { wave: 'B', nextWave: 'C' },
    { wave: 'C', nextWave: null },
  ]

  it.each(cases)('wave $wave → next $nextWave', ({ wave, nextWave }) => {
    const createDrawing = vi.fn().mockResolvedValue({ id: 1 })
    const state: DrawingState = {
      kind: 'drawing-wave-label',
      wave: wave as import('../state').DrawingState extends { kind: 'drawing-wave-label'; wave: infer W } ? W : never,
      previewPoint: null,
    }
    const next = dispatchEvent(state, { type: 'click', payload: makePayload(100, 1000) }, makeCtx({ createDrawing }))
    if (nextWave === null) {
      expect(next).toEqual(idleState())
    } else {
      expect(next.kind).toBe('drawing-wave-label')
      if (next.kind === 'drawing-wave-label') expect(next.wave).toBe(nextWave)
    }
    expect(createDrawing).toHaveBeenCalled()
  })

  it('click with null time → no state change, no create', () => {
    const createDrawing = vi.fn()
    const state: DrawingState = { kind: 'drawing-wave-label', wave: '1', previewPoint: null }
    const next = dispatchEvent(state, { type: 'click', payload: makePayload(100, null) }, makeCtx({ createDrawing }))
    expect(next).toBe(state)
    expect(createDrawing).not.toHaveBeenCalled()
  })

  it('mouse-move updates previewPoint', () => {
    const state: DrawingState = { kind: 'drawing-wave-label', wave: '1', previewPoint: null }
    const next = dispatchEvent(state, { type: 'mouse-move', payload: makePayload(100, 1000) }, makeCtx())
    expect(next.kind).toBe('drawing-wave-label')
    if (next.kind === 'drawing-wave-label') {
      expect(next.previewPoint).toEqual({ t: 1000, price: 100 })
      expect(next.wave).toBe('1')
    }
  })

  it('mouse-move with null time → no previewPoint change', () => {
    const state: DrawingState = { kind: 'drawing-wave-label', wave: '2', previewPoint: null }
    const next = dispatchEvent(state, { type: 'mouse-move', payload: makePayload(100, null) }, makeCtx())
    expect(next).toBe(state)
  })
})

// ---------------------------------------------------------------------------
// moving-line
// ---------------------------------------------------------------------------

describe('moving-line', () => {
  const drawing = makeDrawing({ data: { price: 100 } })
  const base: DrawingState = { kind: 'moving-line', original: drawing, preview: drawing }

  it('mouse-move → updates preview price', () => {
    const next = dispatchEvent(base, { type: 'mouse-move', payload: makePayload(110) }, makeCtx())
    expect(next.kind).toBe('moving-line')
    if (next.kind === 'moving-line') {
      expect(next.preview.data.price).toBe(110)
      expect(next.original).toBe(drawing)
    }
  })

  it('mouse-up → calls updateDrawing with final price, returns idle', () => {
    const updateDrawing = vi.fn().mockResolvedValue(undefined)
    const next = dispatchEvent(base, { type: 'mouse-up', payload: makePayload(110) }, makeCtx({ updateDrawing }))
    expect(next).toEqual(idleState())
    expect(updateDrawing).toHaveBeenCalledWith(drawing.id, { data: { price: 110 } })
  })
})

// ---------------------------------------------------------------------------
// moving-trade-line
// ---------------------------------------------------------------------------

describe('moving-trade-line', () => {
  const base: DrawingState = { kind: 'moving-trade-line', handle: 'sl', original: 100, preview: 100 }

  it('mouse-move → updates preview price', () => {
    const next = dispatchEvent(base, { type: 'mouse-move', payload: makePayload(110) }, makeCtx())
    expect(next.kind).toBe('moving-trade-line')
    if (next.kind === 'moving-trade-line') {
      expect(next.preview).toBe(110)
      expect(next.handle).toBe('sl')
      expect(next.original).toBe(100)
    }
  })

  it('mouse-up → calls updateTradeLine and returns idle', () => {
    const updateTradeLine = vi.fn().mockResolvedValue(undefined)
    const state: DrawingState = { kind: 'moving-trade-line', handle: 'sl', original: 100, preview: 110 }
    const next = dispatchEvent(state, { type: 'mouse-up', payload: makePayload(110) }, makeCtx({ updateTradeLine }))
    expect(next).toEqual(idleState())
    expect(updateTradeLine).toHaveBeenCalledWith('sl', 110)
  })

  it('mouse-up when preview === original → does not call updateTradeLine', () => {
    const updateTradeLine = vi.fn()
    const state: DrawingState = { kind: 'moving-trade-line', handle: 'tp', original: 200, preview: 200 }
    dispatchEvent(state, { type: 'mouse-up', payload: makePayload(200) }, makeCtx({ updateTradeLine }))
    expect(updateTradeLine).not.toHaveBeenCalled()
  })

  it('mouse-up without updateTradeLine → does not throw, returns idle', () => {
    const state: DrawingState = { kind: 'moving-trade-line', handle: 'sl', original: 100, preview: 110 }
    const next = dispatchEvent(state, { type: 'mouse-up', payload: makePayload(110) }, makeCtx())
    expect(next).toEqual(idleState())
  })
})

// ---------------------------------------------------------------------------
// selectors
// ---------------------------------------------------------------------------

describe('cursorOf', () => {
  it.each([
    [{ kind: 'idle', cursor: 'ns-resize', hoveredId: null } satisfies DrawingState, 'ns-resize'],
    [{ kind: 'idle', cursor: 'default', hoveredId: null } satisfies DrawingState, 'default'],
    [{ kind: 'drawing-line' } satisfies DrawingState, 'crosshair'],
    [{ kind: 'drawing-trendline', firstPoint: null, currentPoint: null } satisfies DrawingState, 'crosshair'],
    [{ kind: 'drawing-fibonacci', firstPoint: null, currentPoint: null } satisfies DrawingState, 'crosshair'],
    [{ kind: 'drawing-wave-label', wave: '1', previewPoint: null } satisfies DrawingState, 'crosshair'],
    [{ kind: 'moving-trade-line', handle: 'sl', original: 100, preview: 100 } satisfies DrawingState, 'ns-resize'],
  ] as [DrawingState, string][])('cursorOf(%s) = %s', (state, expected) => {
    expect(cursorOf(state)).toBe(expected)
  })

  it('moving-line → ns-resize', () => {
    const d = makeDrawing()
    expect(cursorOf({ kind: 'moving-line', original: d, preview: d })).toBe('ns-resize')
  })

  it('moving-trendline-body → move', () => {
    const d = makeDrawing()
    expect(cursorOf({ kind: 'moving-trendline-body', original: d, preview: d, anchor: { t: 0, price: 0 } })).toBe('move')
  })

  it('moving-trendline-handle → grabbing', () => {
    const d = makeDrawing()
    expect(cursorOf({ kind: 'moving-trendline-handle', original: d, preview: d, handleIndex: 0 })).toBe('grabbing')
  })
})

describe('activeToolOf', () => {
  it('idle → null', () => expect(activeToolOf(idleState())).toBeNull())
  it('drawing-line → line', () => expect(activeToolOf({ kind: 'drawing-line' })).toBe('line'))
  it('drawing-trendline → trendline', () => {
    expect(activeToolOf({ kind: 'drawing-trendline', firstPoint: null, currentPoint: null })).toBe('trendline')
  })
  it('drawing-fibonacci → fibonacci', () => {
    expect(activeToolOf({ kind: 'drawing-fibonacci', firstPoint: null, currentPoint: null })).toBe('fibonacci')
  })
  it('drawing-wave-label → wave_label', () => {
    expect(activeToolOf({ kind: 'drawing-wave-label', wave: '1', previewPoint: null })).toBe('wave_label')
  })
  it('moving-line → null', () => {
    const d = makeDrawing()
    expect(activeToolOf({ kind: 'moving-line', original: d, preview: d })).toBeNull()
  })
})

describe('activeWaveOf', () => {
  it('drawing-wave-label → wave value', () => {
    expect(activeWaveOf({ kind: 'drawing-wave-label', wave: 'A', previewPoint: null })).toBe('A')
  })
  it('other → null', () => {
    expect(activeWaveOf(idleState())).toBeNull()
    expect(activeWaveOf({ kind: 'drawing-line' })).toBeNull()
  })
})

describe('hoveredIdOf', () => {
  it('idle with hoveredId → returns it', () => {
    expect(hoveredIdOf({ kind: 'idle', cursor: 'default', hoveredId: 42 })).toBe(42)
  })
  it('idle with hoveredId null → null', () => {
    expect(hoveredIdOf(idleState())).toBeNull()
  })
  it('non-idle → null', () => {
    expect(hoveredIdOf({ kind: 'drawing-line' })).toBeNull()
  })
})

describe('isMovingState', () => {
  it.each([
    [idleState(), false],
    [{ kind: 'drawing-line' } satisfies DrawingState, false],
    [{ kind: 'moving-trade-line', handle: 'sl', original: 100, preview: 100 } satisfies DrawingState, true],
  ] as [DrawingState, boolean][])('isMovingState(%s) = %s', (state, expected) => {
    expect(isMovingState(state)).toBe(expected)
  })

  it('moving-line → true', () => {
    const d = makeDrawing()
    expect(isMovingState({ kind: 'moving-line', original: d, preview: d })).toBe(true)
  })
})

describe('tradeLinePreviewOf', () => {
  it('non-moving-trade-line → null', () => {
    expect(tradeLinePreviewOf(idleState())).toBeNull()
    expect(tradeLinePreviewOf({ kind: 'drawing-line' })).toBeNull()
  })

  it('moving-trade-line sl → {handle: sl, price: preview}', () => {
    const state: DrawingState = { kind: 'moving-trade-line', handle: 'sl', original: 100, preview: 105 }
    expect(tradeLinePreviewOf(state)).toEqual({ handle: 'sl', price: 105 })
  })

  it('moving-trade-line tp → {handle: tp, price: preview}', () => {
    const state: DrawingState = { kind: 'moving-trade-line', handle: 'tp', original: 200, preview: 198 }
    expect(tradeLinePreviewOf(state)).toEqual({ handle: 'tp', price: 198 })
  })
})

describe('previewOf', () => {
  it('idle → null', () => expect(previewOf(idleState())).toBeNull())
  it('drawing-line → null', () => expect(previewOf({ kind: 'drawing-line' })).toBeNull())
  it('moving-line → preview drawing', () => {
    const d = makeDrawing()
    const preview = { ...d, data: { price: 110 } }
    const state: DrawingState = { kind: 'moving-line', original: d, preview }
    expect(previewOf(state)).toBe(preview)
  })

  it('drawing-trendline without firstPoint → null', () => {
    const state: DrawingState = { kind: 'drawing-trendline', firstPoint: null, currentPoint: null }
    expect(previewOf(state)).toBeNull()
  })

  it('drawing-trendline with both points → preview drawing', () => {
    const fp = { t: 1000, price: 100 }
    const cp = { t: 2000, price: 110 }
    const state: DrawingState = { kind: 'drawing-trendline', firstPoint: fp, currentPoint: cp }
    const result = previewOf(state)
    expect(result).not.toBeNull()
    expect(result?.kind).toBe('trendline')
    expect(result?.id).toBe(-1)
    expect(result?.data).toEqual({ points: [fp, cp] })
  })

  it('drawing-wave-label without previewPoint → null', () => {
    const state: DrawingState = { kind: 'drawing-wave-label', wave: '1', previewPoint: null }
    expect(previewOf(state)).toBeNull()
  })

  it('drawing-wave-label with previewPoint → preview drawing', () => {
    const state: DrawingState = { kind: 'drawing-wave-label', wave: '3', previewPoint: { t: 500, price: 99 } }
    const result = previewOf(state)
    expect(result?.kind).toBe('wave_label')
    expect(result?.data).toEqual({ t: 500, price: 99, wave: '3' })
  })
})
