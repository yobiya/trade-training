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
 * マルチタイムフレーム縦積み表示のチャートデータを一括管理する(§5.1 / §6.1)。
 * 統合フロー対応: symbol を外部から受け取り、銘柄切替で自動再取得する。
 * symbol が空文字 / null の場合は取得しない(= 分析前の初期状態)。
 * currentPrice は entryTf の最新終値を返す(トレード入力のデフォルト価格参考)。
 */
export function useCharts(
  sessionId: string,
  symbol: string | null | undefined,
  timeframes: string[],
  entryTf: string,
): ChartsApi {
  const [barsByTf, setBarsByTf] = useState<Record<string, OhlcBar[]>>({})
  const loadingByTfRef = useRef<Record<string, boolean>>({})
  const noMoreByTfRef = useRef<Record<string, boolean>>({})

  const entryBars = barsByTf[entryTf] ?? []
  const currentPrice = entryBars.length > 0 ? entryBars[entryBars.length - 1].c : null

  const tfsKey = [...timeframes].sort().join(',')
  const effectiveSymbol = symbol || ''

  const fetchAll = useCallback(async (tfs: string[]): Promise<Record<string, OhlcBar[]>> => {
    if (!effectiveSymbol) return {}
    const results = await Promise.all(
      tfs.map(tf => api.chart.get(sessionId, tf, BARS_BY_TF[tf] ?? 200, undefined, effectiveSymbol)),
    )
    const next: Record<string, OhlcBar[]> = {}
    tfs.forEach((tf, i) => {
      next[tf] = results[i].bars
      noMoreByTfRef.current[tf] = false
    })
    return next
  }, [sessionId, effectiveSymbol])

  useEffect(() => {
    // 銘柄切替 / TF 切替: 一旦空にしてから取得(前の銘柄の残像を防ぐ)
    if (!effectiveSymbol) {
      setBarsByTf({})
      return
    }
    void fetchAll(tfsKey.split(',')).then(fetched => {
      setBarsByTf(fetched)
    })
  }, [fetchAll, tfsKey, effectiveSymbol])

  const reloadAll = useCallback(async () => {
    const next = await fetchAll(tfsKey.split(','))
    setBarsByTf(prev => ({ ...prev, ...next }))
  }, [fetchAll, tfsKey])

  const loadMoreHistory = useCallback(async (tf: string, earliest: number) => {
    if (!effectiveSymbol) return
    if (loadingByTfRef.current[tf] || noMoreByTfRef.current[tf]) return
    loadingByTfRef.current[tf] = true
    try {
      const barsCount = BARS_BY_TF[tf] ?? 200
      const chartData = await api.chart.get(sessionId, tf, barsCount, earliest, effectiveSymbol)
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
  }, [sessionId, effectiveSymbol])

  return { barsByTf, currentPrice, reloadAll, loadMoreHistory }
}
