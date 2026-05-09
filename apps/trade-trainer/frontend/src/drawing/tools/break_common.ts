import type { OhlcBar } from '../../api/types'

/**
 * §5.3 high_break / low_break: 共通ヘルパー(snap + ブレイク検出)。
 * 高値ブレイクと安値ブレイクで共通する純粋ロジックをここに集約する。
 */

export type BreakMode = 'above' | 'below'

/**
 * 時刻 `time` に最も近いバーを返す(クリック → バー snap 用)。
 * 範囲外の time は両端のバーへ飽和。bars 空時は null。
 */
export function snapToBar(bars: OhlcBar[], time: number): OhlcBar | null {
  if (bars.length === 0) return null
  if (time <= bars[0].t) return bars[0]
  const last = bars.length - 1
  if (time >= bars[last].t) return bars[last]
  let lo = 0
  let hi = last
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].t < time) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return bars[0]
  const prev = bars[lo - 1]
  const next = bars[lo]
  return Math.abs(time - prev.t) <= Math.abs(time - next.t) ? prev : next
}

/**
 * 選択時刻 `selectedT` 以降の確定バー終値が `price` をブレイクしたか判定する。
 * - 評価対象: `bars[i].t > selectedT` かつ `i < bars.length - 1`(最終 bar = live bar として除外、I-8)
 * - mode='above': close > price で確定
 * - mode='below': close < price で確定
 *
 * 戻り値: ブレイクが確定した bars の index。未ブレイクは -1。
 */
export function detectBreak(
  bars: OhlcBar[],
  selectedT: number,
  price: number,
  mode: BreakMode,
): number {
  // bars[lastIdx] は live bar として除外する。
  // bars が 1 本以下のときは評価対象なし。
  const lastEvalIdx = bars.length - 1
  for (let i = 0; i < lastEvalIdx; i++) {
    if (bars[i].t <= selectedT) continue
    if (mode === 'above' && bars[i].c > price) return i
    if (mode === 'below' && bars[i].c < price) return i
  }
  return -1
}
