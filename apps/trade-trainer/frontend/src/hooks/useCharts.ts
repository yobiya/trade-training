import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { OhlcBar } from '../api/client'

// 時間足ごとに取得するバー本数(仕様書 §5.1)。
export const BARS_BY_TF: Record<string, number> = {
  M5: 500, M15: 400, M30: 400, H1: 400, H4: 300, D1: 200,
}

// メイン時間足を選んだときに並行表示する上位足(仕様書 §5.1)。
// D1 は最上位のため上位足なしで main のみ表示。
export const UPPER_TFS: Record<string, string[]> = {
  M5: ['M15', 'H1', 'H4'],
  M15: ['H1', 'H4', 'D1'],
  M30: ['H1', 'H4', 'D1'],
  H1: ['H4', 'D1'],
  H4: ['D1'],
  D1: [],
}

export type ChartsApi = {
  /** 表示中の各時間足のバー配列 */
  barsByTf: Record<string, OhlcBar[]>
  /** 現在の上位足一覧(メイン時間足から導出) */
  upperTfs: string[]
  /** メイン時間足の最新バーの終値(未取得時は null) */
  currentPrice: number | null
  /** メイン + 上位足を一括再取得する */
  reloadAll: () => Promise<void>
  /** 時間足の左端に近づいた際の過去バー追加取得(Chart の onNeedMoreHistory から呼ぶ) */
  loadMoreHistory: (tf: string, earliest: number) => Promise<void>
}

/**
 * マルチタイムフレーム表示のチャートデータを一括管理する。
 * メイン時間足が変わると全関連 TF を並列取得、左端遅延ロードは TF 毎に独立。
 */
export function useCharts(sessionId: string, timeframe: string): ChartsApi {
  const [barsByTf, setBarsByTf] = useState<Record<string, OhlcBar[]>>({})
  const loadingByTfRef = useRef<Record<string, boolean>>({})
  const noMoreByTfRef = useRef<Record<string, boolean>>({})

  const upperTfs = UPPER_TFS[timeframe] ?? []
  const mainBars = barsByTf[timeframe] ?? []
  const currentPrice = mainBars.length > 0 ? mainBars[mainBars.length - 1].c : null

  const fetchAll = useCallback(async (main: string): Promise<Record<string, OhlcBar[]>> => {
    const tfs = [main, ...(UPPER_TFS[main] ?? [])]
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
    void fetchAll(timeframe).then(setBarsByTf)
  }, [fetchAll, timeframe])

  const reloadAll = useCallback(async () => {
    const next = await fetchAll(timeframe)
    setBarsByTf(next)
  }, [fetchAll, timeframe])

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

  return { barsByTf, upperTfs, currentPrice, reloadAll, loadMoreHistory }
}
