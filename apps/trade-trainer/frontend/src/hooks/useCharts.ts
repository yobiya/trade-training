import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { OhlcBar } from '../api/client'
import { BARS_BY_TF } from '../constants'

export type ChartsApi = {
  /** 表示中の各時間足のバー配列 */
  barsByTf: Record<string, OhlcBar[]>
  /** エントリー足の最新バー終値(未取得時は null) */
  currentPrice: number | null
  /** 指定 TF を一括再取得する */
  reloadAll: () => Promise<void>
  /** 時間足の左端に近づいた際の過去バー追加取得(Chart の onNeedMoreHistory から呼ぶ) */
  loadMoreHistory: (tf: string, earliest: number) => Promise<void>
}

/**
 * マルチタイムフレーム縦積み表示のチャートデータを一括管理する(§5.1)。
 * timeframes に指定した全 TF を並列取得、左端遅延ロードは TF 毎に独立。
 * currentPrice は entryTf の最新終値を返す(トレード入力のデフォルト価格参考)。
 */
export function useCharts(sessionId: string, timeframes: string[], entryTf: string): ChartsApi {
  const [barsByTf, setBarsByTf] = useState<Record<string, OhlcBar[]>>({})
  const loadingByTfRef = useRef<Record<string, boolean>>({})
  const noMoreByTfRef = useRef<Record<string, boolean>>({})

  const entryBars = barsByTf[entryTf] ?? []
  const currentPrice = entryBars.length > 0 ? entryBars[entryBars.length - 1].c : null

  // timeframes 配列の identity 変化を避けるため key 化
  const tfsKey = [...timeframes].sort().join(',')

  const fetchAll = useCallback(async (tfs: string[]): Promise<Record<string, OhlcBar[]>> => {
    const results = await Promise.all(
      tfs.map(tf => api.chart.get(sessionId, tf, BARS_BY_TF[tf] ?? 200)),
    )
    const next: Record<string, OhlcBar[]> = {}
    tfs.forEach((tf, i) => {
      next[tf] = results[i].bars
      noMoreByTfRef.current[tf] = false
    })
    return next
  }, [sessionId])

  useEffect(() => {
    void fetchAll(tfsKey.split(',')).then(fetched => {
      setBarsByTf(prev => ({ ...prev, ...fetched }))
    })
  }, [fetchAll, tfsKey])

  const reloadAll = useCallback(async () => {
    const next = await fetchAll(tfsKey.split(','))
    setBarsByTf(prev => ({ ...prev, ...next }))
  }, [fetchAll, tfsKey])

  const loadMoreHistory = useCallback(async (tf: string, earliest: number) => {
    if (loadingByTfRef.current[tf] || noMoreByTfRef.current[tf]) return
    loadingByTfRef.current[tf] = true
    try {
      const barsCount = BARS_BY_TF[tf] ?? 200
      const chartData = await api.chart.get(sessionId, tf, barsCount, earliest)
      const newBars = chartData.bars.filter(b => b.t < earliest)
      if (newBars.length === 0) {
        noMoreByTfRef.current[tf] = true
        return
      }
      setBarsByTf(prev => {
        const existing = prev[tf] ?? []
        const seen = new Set(existing.map(b => b.t))
        const fresh = newBars.filter(b => !seen.has(b.t))
        return { ...prev, [tf]: [...fresh, ...existing] }
      })
    } finally {
      loadingByTfRef.current[tf] = false
    }
  }, [sessionId])

  return { barsByTf, currentPrice, reloadAll, loadMoreHistory }
}
