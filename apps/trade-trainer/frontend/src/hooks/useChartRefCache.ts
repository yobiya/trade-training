import { useCallback, useRef, useState } from 'react'
import type { ChartHandle } from '../components/Chart'

export type ChartRefCache = {
  /** TF → ChartHandle の現在の対応 */
  handles: Map<string, ChartHandle>
  /** TF ごとの ref コールバックを取得(同じ TF に対しては常に同じ関数を返す)。
   * Chart の ref に渡して、Chart がマウント/アンマウントすると自動的に handles が更新される。 */
  setRef: (tf: string) => (handle: ChartHandle | null) => void
}

/**
 * 複数 TF の Chart ハンドルを管理する共通フック。
 * - ref コールバックを TF ごとにキャッシュして stable にする(毎回新しい関数を返すと
 *   Chart の ref 再設定で無限ループになる)
 * - setState の中で同一参照なら state を更新しない(React が同じ値で ref を呼んでも
 *   再レンダを起こさない)
 */
export function useChartRefCache(): ChartRefCache {
  const [handles, setHandles] = useState<Map<string, ChartHandle>>(new Map())
  const callbacksRef = useRef<Map<string, (h: ChartHandle | null) => void>>(new Map())

  const setRef = useCallback((tf: string) => {
    let cb = callbacksRef.current.get(tf)
    if (!cb) {
      cb = (handle: ChartHandle | null) => {
        setHandles(prev => {
          if (prev.get(tf) === (handle ?? undefined)) return prev
          const next = new Map(prev)
          if (handle) next.set(tf, handle)
          else next.delete(tf)
          return next
        })
      }
      callbacksRef.current.set(tf, cb)
    }
    return cb
  }, [])

  return { handles, setRef }
}
