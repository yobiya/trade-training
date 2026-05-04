import type { OhlcBar } from '../api/client'

/**
 * §5.5.4: マーカー時刻を `bars` の最寄りバー timestamp にスナップする。
 * lightweight-charts は厳密一致する time でないとマーカーを描画しない。
 */
export function nearestBarTime(bars: OhlcBar[], targetUnix: number): number | null {
  if (bars.length === 0) return null
  let nearest = bars[0].t
  let bestDiff = Math.abs(targetUnix - nearest)
  for (const b of bars) {
    const d = Math.abs(targetUnix - b.t)
    if (d < bestDiff) {
      nearest = b.t
      bestDiff = d
    }
  }
  return nearest
}
