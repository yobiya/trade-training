import { describe, it, expect } from 'vitest'
import { calcSMA, calcEMA, calcRSI } from '../calculations'
import type { OhlcBar } from '../../api/types'

function bars(closes: number[]): OhlcBar[] {
  return closes.map((c, i) => ({ t: i * 60, o: c, h: c, l: c, c, v: 0 }))
}

// ---------------------------------------------------------------------------
// calcSMA
// ---------------------------------------------------------------------------

describe('calcSMA', () => {
  it('period <= 0 → []', () => {
    expect(calcSMA(bars([10, 20, 30]), 0)).toEqual([])
    expect(calcSMA(bars([10, 20, 30]), -1)).toEqual([])
  })

  it('bars.length < period → []', () => {
    expect(calcSMA(bars([10, 20]), 3)).toEqual([])
  })

  it('period = 1 → 各バーの終値', () => {
    const result = calcSMA(bars([10, 20, 30]), 1)
    expect(result.map(p => p.value)).toEqual([10, 20, 30])
    expect(result.map(p => p.time)).toEqual([0, 60, 120])
  })

  it('period = 3: スライディング平均', () => {
    // [10,20,30,40]: (10+20+30)/3=20, (20+30+40)/3=30
    const result = calcSMA(bars([10, 20, 30, 40]), 3)
    expect(result).toHaveLength(2)
    expect(result[0].value).toBeCloseTo(20)
    expect(result[1].value).toBeCloseTo(30)
    expect(result[0].time).toBe(120) // bars[2].t
    expect(result[1].time).toBe(180) // bars[3].t
  })

  it('全バーが同値 → 全ポイントが同値', () => {
    const result = calcSMA(bars([5, 5, 5, 5]), 2)
    result.forEach(p => expect(p.value).toBe(5))
  })

  it('bars.length === period → 1 ポイントのみ', () => {
    const result = calcSMA(bars([10, 20, 30]), 3)
    expect(result).toHaveLength(1)
    expect(result[0].value).toBeCloseTo(20)
  })
})

// ---------------------------------------------------------------------------
// calcEMA
// ---------------------------------------------------------------------------

describe('calcEMA', () => {
  it('period <= 0 → []', () => {
    expect(calcEMA(bars([10, 20, 30]), 0)).toEqual([])
  })

  it('bars.length < period → []', () => {
    expect(calcEMA(bars([10, 20]), 3)).toEqual([])
  })

  it('period = 1: k=1 のため各バーの終値と一致', () => {
    // k = 2/(1+1) = 1。ema = close * 1 + prev * 0 = close
    const result = calcEMA(bars([10, 20, 30]), 1)
    expect(result.map(p => p.value)).toEqual([10, 20, 30])
  })

  it('period = 2: 初期値は先頭 2 本の SMA', () => {
    // bars=[10,20,30]。seed=(10+20)/2=15。k=2/3
    // i=2: ema = 30*(2/3) + 15*(1/3) = 20+5 = 25
    const result = calcEMA(bars([10, 20, 30]), 2)
    expect(result).toHaveLength(2)
    expect(result[0].value).toBeCloseTo(15)
    expect(result[0].time).toBe(60) // bars[1].t
    expect(result[1].value).toBeCloseTo(25)
    expect(result[1].time).toBe(120) // bars[2].t
  })

  it('bars.length === period → 1 ポイント(シードのみ)', () => {
    const result = calcEMA(bars([10, 20, 30]), 3)
    expect(result).toHaveLength(1)
    expect(result[0].value).toBeCloseTo(20) // SMA(10+20+30)/3
  })

  it('全バーが同値 → EMA も同値', () => {
    const result = calcEMA(bars([5, 5, 5, 5, 5]), 3)
    result.forEach(p => expect(p.value).toBeCloseTo(5))
  })

  it('period = 3: 収束性(十分な本数で実際の値に近づく)', () => {
    // 100 本すべて同値 → EMA ≈ 100
    const result = calcEMA(bars(Array(100).fill(100)), 3)
    expect(result[result.length - 1].value).toBeCloseTo(100)
  })
})

// ---------------------------------------------------------------------------
// calcRSI
// ---------------------------------------------------------------------------

describe('calcRSI', () => {
  it('period <= 0 → []', () => {
    expect(calcRSI(bars([10, 20, 30]), 0)).toEqual([])
  })

  it('bars.length < period + 1 → []', () => {
    // period=2 には最低 3 本必要
    expect(calcRSI(bars([10, 20]), 2)).toEqual([])
  })

  it('全バーが上昇 → RSI = 100', () => {
    // avgLoss = 0 → RSI = 100
    const result = calcRSI(bars([100, 101, 102, 103]), 2)
    expect(result[0].value).toBe(100)
  })

  it('全バーが下降 → RSI = 0', () => {
    // avgGain = 0, avgLoss > 0 → RSI = 100 - 100/(1+0) = 0
    const result = calcRSI(bars([103, 102, 101, 100]), 2)
    expect(result[0].value).toBe(0)
  })

  it('period = 2: 混合バーの RSI を手計算で検証', () => {
    // bars=[100,101,99], period=2
    // i=1: change=+1, avgGain=1
    // i=2: change=-2, avgLoss=2
    // avgGain=0.5, avgLoss=1.0
    // RSI = 100 - 100/(1 + 0.5/1) = 100 - 100/1.5 ≈ 33.33
    const result = calcRSI(bars([100, 101, 99]), 2)
    expect(result).toHaveLength(1)
    expect(result[0].value).toBeCloseTo(33.33, 1)
    expect(result[0].time).toBe(120) // bars[2].t
  })

  it('Wilder 方式の再帰更新: 次の値も正しい', () => {
    // bars=[100,101,99,102], period=2
    // 初回: avgGain=0.5, avgLoss=1.0 (from [100,101,99] above)
    // i=3: change=102-99=3>0, gain=3, loss=0
    // avgGain = (0.5*1 + 3) / 2 = 1.75
    // avgLoss = (1.0*1 + 0) / 2 = 0.5
    // RSI = 100 - 100/(1 + 1.75/0.5) = 100 - 100/4.5 ≈ 77.78
    const result = calcRSI(bars([100, 101, 99, 102]), 2)
    expect(result).toHaveLength(2)
    expect(result[1].value).toBeCloseTo(77.78, 1)
  })

  it('出力長 = bars.length - period', () => {
    const n = 20
    const period = 5
    const result = calcRSI(bars(Array.from({ length: n }, (_, i) => 100 + i)), period)
    expect(result).toHaveLength(n - period)
  })

  it('time は対応するバーの t と一致', () => {
    const result = calcRSI(bars([100, 101, 99, 102, 100]), 2)
    // 最初の出力は bars[2](t=120)、2 番目は bars[3](t=180)、3 番目は bars[4](t=240)
    expect(result[0].time).toBe(120)
    expect(result[1].time).toBe(180)
    expect(result[2].time).toBe(240)
  })
})
