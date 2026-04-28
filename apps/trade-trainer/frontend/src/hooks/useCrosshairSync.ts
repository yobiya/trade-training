import { useEffect } from 'react'
import type { ChartHandle } from '../components/Chart'

/**
 * §5.1.2 マルチ TF クロスヘア同期(ver 1.55 で `SessionPage` から hook に集約)。
 *
 * 各 Chart の `ChartHandle.subscribeUserCrosshair` を購読し、ある TF でユーザーが
 * クロスヘアを動かしたら、他のすべての TF に対して `ChartHandle.setCrosshairTime` を呼ぶ。
 *
 * - 状態を React の useState で持たない(各 Chart が命令的 API で同期される)
 * - origin tf は購読時の closure に閉じているため、自分自身に対する呼び出しは行わない
 * - Chart 側は `setCrosshairTime` 経由の programmatic move を再 emit しない仕様 → feedback ループ無し
 */
export function useCrosshairSync(
  chartHandles: Map<string, ChartHandle>,
): void {
  useEffect(() => {
    const unsubs: Array<() => void> = []
    for (const [originTf, originHandle] of chartHandles) {
      const unsub = originHandle.subscribeUserCrosshair((time) => {
        for (const [tf, handle] of chartHandles) {
          if (tf === originTf) continue
          handle.setCrosshairTime(time)
        }
      })
      unsubs.push(unsub)
    }
    return () => {
      for (const u of unsubs) u()
    }
    // chartHandles は Map インスタンス自体の参照変更で再購読する想定
    // (useChartRefCache は handles の追加削除で新 Map を返す)
  }, [chartHandles])
}
