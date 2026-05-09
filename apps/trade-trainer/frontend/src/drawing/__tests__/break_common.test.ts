import { describe, it, expect } from 'vitest'
import { detectBreak, snapToBar } from '../tools/break_common'
import type { OhlcBar } from '../../api/types'

function bar(t: number, h: number, l: number, c: number): OhlcBar {
  return { t, o: 0, h, l, c, v: 0 }
}

describe('snapToBar', () => {
  const bars = [bar(100, 0, 0, 0), bar(200, 0, 0, 0), bar(300, 0, 0, 0)]

  it('完全一致 → そのバー', () => {
    expect(snapToBar(bars, 200)?.t).toBe(200)
  })

  it('間 → 近い側', () => {
    expect(snapToBar(bars, 140)?.t).toBe(100)
    expect(snapToBar(bars, 160)?.t).toBe(200)
    expect(snapToBar(bars, 250)?.t).toBe(200)  // 等距離は前を優先
    expect(snapToBar(bars, 251)?.t).toBe(300)
  })

  it('範囲外 → 両端のバーへ飽和', () => {
    expect(snapToBar(bars, 0)?.t).toBe(100)
    expect(snapToBar(bars, 1000)?.t).toBe(300)
  })

  it('空配列 → null', () => {
    expect(snapToBar([], 100)).toBeNull()
  })
})

describe('detectBreak', () => {
  // 5 本のバー: indices 0..4。最終 (idx=4) は live bar として除外される
  // bars[i] の t = (i+1) * 100、close は引数の breakingClose による
  function makeBars(closes: number[], highs?: number[], lows?: number[]): OhlcBar[] {
    return closes.map((c, i) => bar(
      (i + 1) * 100,
      highs?.[i] ?? c,
      lows?.[i] ?? c,
      c,
    ))
  }

  describe('mode = above', () => {
    it('閾値超え close を検出', () => {
      // selectedT=100 (idx 0), price=150
      // bars: idx0(close=100), idx1(close=140), idx2(close=160 ← break), idx3(close=180), idx4=live
      const bars = makeBars([100, 140, 160, 180, 200])
      expect(detectBreak(bars, 100, 150, 'above')).toBe(2)
    })

    it('閾値ちょうど(=)はブレイクしない', () => {
      // close > price の strict なので 150 は break ではない
      const bars = makeBars([100, 150, 160, 180, 200])
      expect(detectBreak(bars, 100, 150, 'above')).toBe(2)
    })

    it('未ブレイク → -1', () => {
      const bars = makeBars([100, 110, 120, 130, 200])  // idx4 は live で除外
      expect(detectBreak(bars, 100, 150, 'above')).toBe(-1)
    })

    it('live bar(最終 bar)は除外', () => {
      // idx4 の close=999 がブレイクしているが live bar として除外される
      const bars = makeBars([100, 110, 120, 130, 999])
      expect(detectBreak(bars, 100, 150, 'above')).toBe(-1)
    })

    it('selectedT 以前のバーは無視', () => {
      // selectedT=200 → idx0 (t=100) は無視
      const bars = makeBars([999, 110, 120, 160, 200])
      expect(detectBreak(bars, 200, 150, 'above')).toBe(3)
    })
  })

  describe('mode = below', () => {
    it('閾値下回る close を検出', () => {
      const bars = makeBars([200, 180, 140, 130, 100])  // idx2 で 140 < 150
      expect(detectBreak(bars, 100, 150, 'below')).toBe(2)
    })

    it('未ブレイク → -1', () => {
      const bars = makeBars([200, 180, 160, 155, 100])  // idx4 は live で除外
      expect(detectBreak(bars, 100, 150, 'below')).toBe(-1)
    })

    it('live bar は除外', () => {
      const bars = makeBars([200, 180, 160, 155, 50])
      expect(detectBreak(bars, 100, 150, 'below')).toBe(-1)
    })
  })

  it('bars が 0 / 1 本 → -1', () => {
    expect(detectBreak([], 100, 150, 'above')).toBe(-1)
    expect(detectBreak([bar(100, 200, 100, 200)], 50, 150, 'above')).toBe(-1)
  })
})
