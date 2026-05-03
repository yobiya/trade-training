import { describe, it, expect } from 'vitest'
import { lineTool } from '../tools/line'
import { trendlineTool } from '../tools/trendline'
import { fibonacciTool } from '../tools/fibonacci'
import type { Drawing } from '../../api/types'
import type { ChartApi, PointPx } from '../types'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeDrawing(kind: Drawing['kind'], data: Record<string, unknown>, id = 1): Drawing {
  return {
    id,
    session_id: 'sess',
    symbol: null,
    kind,
    data,
    label: null,
    timeframe: 'M5',
    visible_on_timeframes: null,
  }
}

/**
 * 恒等変換 API。timeToX(t) = t/10、priceToY(p) = 100 - p。
 * t=0→x=0, t=1000→x=100, price=100→y=0, price=0→y=100。
 */
function makeIdentityApi(): ChartApi {
  return {
    priceToY: (p) => 100 - p,
    yToPrice: (y) => 100 - y,
    timeToX: (t) => t / 10,
    xToTime: (x) => x * 10,
    logicalToX: () => null,
    setScrollEnabled: () => {},
  }
}

function makeNullApi(): ChartApi {
  return {
    priceToY: () => null,
    yToPrice: () => null,
    timeToX: () => null,
    xToTime: () => null,
    logicalToX: () => null,
    setScrollEnabled: () => {},
  }
}

// ---------------------------------------------------------------------------
// lineTool.hitTest
// ---------------------------------------------------------------------------

describe('lineTool.hitTest', () => {
  // price=50 → y = 100-50 = 50
  const d = makeDrawing('line', { price: 50 })

  it('y 距離ゼロ → hit (body)', () => {
    const api = makeIdentityApi()
    expect(lineTool.hitTest(d, { x: 0, y: 50 }, api))
      .toEqual({ drawingId: 1, kind: 'line', part: 'body' })
  })

  it('y 距離 ≤ 6px → hit', () => {
    const api = makeIdentityApi()
    expect(lineTool.hitTest(d, { x: 0, y: 56 }, api)).not.toBeNull()
    expect(lineTool.hitTest(d, { x: 0, y: 44 }, api)).not.toBeNull()
  })

  it('y 距離 > 6px → miss', () => {
    const api = makeIdentityApi()
    expect(lineTool.hitTest(d, { x: 0, y: 57 }, api)).toBeNull()
    expect(lineTool.hitTest(d, { x: 0, y: 43 }, api)).toBeNull()
  })

  it('priceToY が null → miss', () => {
    expect(lineTool.hitTest(d, { x: 0, y: 50 }, makeNullApi())).toBeNull()
  })

  it('price が NaN → miss', () => {
    const bad = makeDrawing('line', { price: 'not-a-number' })
    expect(lineTool.hitTest(bad, { x: 0, y: 50 }, makeIdentityApi())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// trendlineTool.hitTest
// ---------------------------------------------------------------------------

describe('trendlineTool.hitTest', () => {
  // A: t=0 → x=0, price=100 → y=0
  // B: t=1000 → x=100, price=0 → y=100
  const points = [{ t: 0, price: 100 }, { t: 1000, price: 0 }]
  const d = makeDrawing('trendline', { points })

  it('端点 A の近傍 → handle 0', () => {
    const api = makeIdentityApi()
    // A は (x=0, y=0)。距離 sqrt(9+9) ≈ 4.24 < 8
    const result = trendlineTool.hitTest(d, { x: 3, y: 3 }, api)
    expect(result).toEqual({ drawingId: 1, kind: 'trendline', part: 'handle', handleIndex: 0 })
  })

  it('端点 B の近傍 → handle 1', () => {
    const api = makeIdentityApi()
    // B は (x=100, y=100)。distance sqrt(9+9) ≈ 4.24 < 8
    const result = trendlineTool.hitTest(d, { x: 97, y: 97 }, api)
    expect(result).toEqual({ drawingId: 1, kind: 'trendline', part: 'handle', handleIndex: 1 })
  })

  it('線分上の中点付近 → body', () => {
    const api = makeIdentityApi()
    // 中点は (50, 50)。ポインタ (50, 53) の線分距離 ≈ 2.12 < 6
    const result = trendlineTool.hitTest(d, { x: 50, y: 53 }, api)
    expect(result).toEqual({ drawingId: 1, kind: 'trendline', part: 'body' })
  })

  it('線分から遠い位置 → miss', () => {
    const api = makeIdentityApi()
    // ポインタ (50, 60) の線分距離 ≈ 7.07 > 6
    expect(trendlineTool.hitTest(d, { x: 50, y: 60 }, api)).toBeNull()
  })

  it('timeToX が null → miss', () => {
    const partialApi: ChartApi = { ...makeIdentityApi(), timeToX: () => null }
    expect(trendlineTool.hitTest(d, { x: 50, y: 50 }, partialApi)).toBeNull()
  })

  it('priceToY が null → miss', () => {
    const partialApi: ChartApi = { ...makeIdentityApi(), priceToY: () => null }
    expect(trendlineTool.hitTest(d, { x: 50, y: 50 }, partialApi)).toBeNull()
  })

  it('points が不正 → miss', () => {
    const bad = makeDrawing('trendline', { points: [] })
    expect(trendlineTool.hitTest(bad, { x: 50, y: 50 }, makeIdentityApi())).toBeNull()
  })

  it('端点が handle 閾値外かつ線分内 → handle ではなく body', () => {
    const api = makeIdentityApi()
    // (20, 23) は端点 A=(0,0) から distance=sqrt(400+529)≈30.5 > 8 → not handle
    // 線分距離: t≈0.215, proj=(21.5,21.5), dist=sqrt(2.25+6.25)≈2.9 < 6 → body
    const result = trendlineTool.hitTest(d, { x: 20, y: 23 }, api)
    expect(result?.part).toBe('body')
  })
})

// ---------------------------------------------------------------------------
// fibonacciTool.hitTest
// ---------------------------------------------------------------------------

describe('fibonacciTool.hitTest', () => {
  // A: t=0 → x=0, price=100 → y=0 (makeIdentityApi: priceToY(p)=100-p)
  // B: t=1000 → x=100, price=0 → y=100
  // FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
  // priceAtLevel(pts, 0.5) = 100*0.5 + 0*0.5 = 50 → y = priceToY(50) = 50
  const points = [{ t: 0, price: 100 }, { t: 1000, price: 0 }]
  const d = makeDrawing('fibonacci', { points })

  it('端点 A の近傍 → handle 0', () => {
    const api = makeIdentityApi()
    // A は (0,0)。distance sqrt(9+9) ≈ 4.24 < 8
    const result = fibonacciTool.hitTest(d, { x: 3, y: 3 }, api)
    expect(result).toEqual({ drawingId: 1, kind: 'fibonacci', part: 'handle', handleIndex: 0 })
  })

  it('端点 B の近傍 → handle 1', () => {
    const api = makeIdentityApi()
    // B は (100,100)
    const result = fibonacciTool.hitTest(d, { x: 97, y: 97 }, api)
    expect(result).toEqual({ drawingId: 1, kind: 'fibonacci', part: 'handle', handleIndex: 1 })
  })

  it('0.5 レベル線上 (x 範囲内) → body', () => {
    const api = makeIdentityApi()
    // 0.5 レベル: price=50 → y=50。x=50 は [0,100] 内。距離=0 < 6
    const result = fibonacciTool.hitTest(d, { x: 50, y: 50 }, api)
    expect(result).toEqual({ drawingId: 1, kind: 'fibonacci', part: 'body' })
  })

  it('0% レベル線上 (price=0, y=100) → body', () => {
    const api = makeIdentityApi()
    const result = fibonacciTool.hitTest(d, { x: 50, y: 100 }, api)
    expect(result).toEqual({ drawingId: 1, kind: 'fibonacci', part: 'body' })
  })

  it('100% レベル線上 (price=100, y=0) → body', () => {
    const api = makeIdentityApi()
    const result = fibonacciTool.hitTest(d, { x: 50, y: 0 }, api)
    expect(result).toEqual({ drawingId: 1, kind: 'fibonacci', part: 'body' })
  })

  it('x 範囲外 + レベル線の y → miss', () => {
    const api = makeIdentityApi()
    // x=-20 は [0-6, 100+6] = [-6, 106] の外(ぎりぎり内に入らない値)
    // x = -7 は x1-6=-6 より外
    expect(fibonacciTool.hitTest(d, { x: -7, y: 50 }, api)).toBeNull()
  })

  it('レベル線から遠い y → miss', () => {
    const api = makeIdentityApi()
    // 23.6% level: y=76.4, 38.2% level: y=61.8。中点 y≈69 は両方から 7.3px > 6
    expect(fibonacciTool.hitTest(d, { x: 50, y: 69 }, api)).toBeNull()
  })

  it('timeToX が null → miss', () => {
    const partialApi: ChartApi = { ...makeIdentityApi(), timeToX: () => null }
    expect(fibonacciTool.hitTest(d, { x: 50, y: 50 }, partialApi)).toBeNull()
  })

  it('priceToY が null → miss', () => {
    const partialApi: ChartApi = { ...makeIdentityApi(), priceToY: () => null }
    expect(fibonacciTool.hitTest(d, { x: 50, y: 50 }, partialApi)).toBeNull()
  })

  it('points が不正 → miss', () => {
    const bad = makeDrawing('fibonacci', { points: [{ t: 0, price: 100 }] }) // 1点のみ
    expect(fibonacciTool.hitTest(bad, { x: 50, y: 50 }, makeIdentityApi())).toBeNull()
  })

  it('x 範囲逆順(xA > xB)でも body を検出できる', () => {
    // B が左、A が右
    const reversePoints = [{ t: 1000, price: 100 }, { t: 0, price: 0 }]
    const dReverse = makeDrawing('fibonacci', { points: reversePoints }, 2)
    const api = makeIdentityApi()
    // xA=100, xB=0, x1=0, x2=100。0.5 レベル: price=50 → y=50。ポインタ(50, 50)
    const result = fibonacciTool.hitTest(dReverse, { x: 50, y: 50 }, api)
    expect(result).toEqual({ drawingId: 2, kind: 'fibonacci', part: 'body' })
  })
})

// ---------------------------------------------------------------------------
// x 範囲境界の確認 (LINE_HIT_TOLERANCE_PX = 6 のバッファ)
// ---------------------------------------------------------------------------

describe('fibonacciTool.hitTest: x 範囲境界', () => {
  const points = [{ t: 0, price: 100 }, { t: 1000, price: 0 }]
  const d = makeDrawing('fibonacci', { points })
  const api = makeIdentityApi()

  it.each([
    [{ x: -6, y: 50 }, true, 'x = x1 - 6 (境界)'],
    [{ x: 106, y: 50 }, true, 'x = x2 + 6 (境界)'],
    [{ x: -7, y: 50 }, false, 'x < x1 - 6 → 範囲外'],
    [{ x: 107, y: 50 }, false, 'x > x2 + 6 → 範囲外'],
  ] as [PointPx, boolean, string][])('%s', (px, shouldHit) => {
    const result = fibonacciTool.hitTest(d, px, api)
    if (shouldHit) {
      expect(result).not.toBeNull()
    } else {
      expect(result).toBeNull()
    }
  })
})
