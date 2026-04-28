import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { OhlcBar } from '../api/client'
import { useNotify } from './useNotify'

export type ChartsApi = {
  /** TF 別バー配列(ver 1.59: chart-stack で一括取得) */
  barsByTf: Record<string, OhlcBar[]>
  /** TF 別の loading フラグ。chart-stack 受信前は全 TF が true。 */
  loadingByTf: Record<string, boolean>
  /** エントリー足の最新バー終値(未取得時は null) */
  currentPrice: number | null
  /** 全 TF を再取得する(銘柄切替 / advance 後の追従用) */
  reloadStack: () => Promise<void>
  /** 指定 TF の左端到達時に過去バーを追加 fetch して prepend する */
  loadMoreHistory: (tf: string, earliestUnix: number) => Promise<void>
}

/**
 * マルチタイムフレーム縦積み表示のチャートデータを一括管理する(§5.1 / §6.1)。
 *
 * ver 1.59 (chart-stack): backend の単一エンドポイント `/chart-stack` を 1 回呼ぶだけで
 * 全 TF の bars を受け取り、`barsByTf` に展開する。下位 TF から順に直列フェッチされ、
 * 上位 TF の最新バーは下位 TF を集約して算出される(設計 §B I-2)。
 */
export function useCharts(
  sessionId: string,
  symbol: string | null | undefined,
  timeframes: string[],
  entryTf: string,
): ChartsApi {
  const { notify } = useNotify()
  const [barsByTf, setBarsByTf] = useState<Record<string, OhlcBar[]>>({})
  const [loadingByTf, setLoadingByTf] = useState<Record<string, boolean>>({})
  const requestIdRef = useRef(0)
  /** loadMoreHistory の二重発火防止 + 「これ以上過去がない」判定 */
  const historyLoadingRef = useRef<Record<string, boolean>>({})
  const historyExhaustedRef = useRef<Record<string, boolean>>({})

  const entryBars = barsByTf[entryTf] ?? []
  const currentPrice = entryBars.length > 0 ? entryBars[entryBars.length - 1].c : null

  const tfsKey = [...timeframes].sort().join(',')
  const effectiveSymbol = symbol || ''

  const fetchStack = useCallback(async (reqId: number): Promise<void> => {
    if (!effectiveSymbol) return
    try {
      const data = await api.chart.stack(sessionId, effectiveSymbol)
      if (reqId !== requestIdRef.current) return // stale: 別の銘柄/TF 切替が走った
      const next: Record<string, OhlcBar[]> = {}
      for (const entry of data.stacks) {
        next[entry.timeframe] = entry.bars
      }
      setBarsByTf(next)
      const tfs = tfsKey.split(',').filter(Boolean)
      setLoadingByTf(Object.fromEntries(tfs.map(tf => [tf, false])))
    } catch (err) {
      console.warn('[useCharts] chart-stack fetch failed', { sessionId, symbol: effectiveSymbol, err })
      if (reqId !== requestIdRef.current) return
      // I-11.4: ユーザー入力起因(銘柄切替 / 初期表示)の失敗 → notify
      notify(`チャート取得に失敗しました(${effectiveSymbol})。バックエンド接続を確認してください`, 'error')
      const tfs = tfsKey.split(',').filter(Boolean)
      setLoadingByTf(Object.fromEntries(tfs.map(tf => [tf, false])))
    }
  }, [sessionId, effectiveSymbol, tfsKey, notify])

  // 銘柄切替 / TF 集合切替: 一旦空にしてから chart-stack を再取得
  useEffect(() => {
    if (!effectiveSymbol) {
      setBarsByTf({})
      setLoadingByTf({})
      return
    }
    const reqId = ++requestIdRef.current
    setBarsByTf({})
    historyLoadingRef.current = {}
    historyExhaustedRef.current = {}
    const tfs = tfsKey.split(',').filter(Boolean)
    setLoadingByTf(Object.fromEntries(tfs.map(tf => [tf, true])))
    void fetchStack(reqId)
  }, [fetchStack, tfsKey, effectiveSymbol])

  const reloadStack = useCallback(async () => {
    if (!effectiveSymbol) return
    const reqId = ++requestIdRef.current
    historyLoadingRef.current = {}
    historyExhaustedRef.current = {}
    const tfs = tfsKey.split(',').filter(Boolean)
    setLoadingByTf(Object.fromEntries(tfs.map(tf => [tf, true])))
    await fetchStack(reqId)
  }, [fetchStack, tfsKey, effectiveSymbol])

  /** 過去バー追加取得。Chart の左端到達時に呼ばれる。 */
  const loadMoreHistory = useCallback(async (tf: string, earliestUnix: number) => {
    if (!effectiveSymbol) return
    if (historyLoadingRef.current[tf] || historyExhaustedRef.current[tf]) return
    historyLoadingRef.current[tf] = true
    try {
      const data = await api.chart.history(sessionId, tf, earliestUnix, 200, effectiveSymbol)
      if (data.bars.length === 0) {
        historyExhaustedRef.current[tf] = true
        return
      }
      setBarsByTf(prev => {
        const existing = prev[tf] ?? []
        // 重複除去 + 昇順ソート(レースで earliestUnix が古くなった場合の安全弁)。
        // chart-stack 再読み込みと loadMoreHistory が時間的に交錯すると、
        // 単純な [...fresh, ...existing] では順序が崩れることがある。
        const merged = new Map<number, OhlcBar>()
        for (const b of existing) merged.set(b.t, b)
        for (const b of data.bars) {
          if (!merged.has(b.t)) merged.set(b.t, b)
        }
        if (merged.size === existing.length) {
          historyExhaustedRef.current[tf] = true
          return prev
        }
        const sorted = Array.from(merged.values()).sort((a, b) => a.t - b.t)
        return { ...prev, [tf]: sorted }
      })
    } catch (err) {
      console.warn('[useCharts] loadMoreHistory failed', { tf, sessionId, symbol: effectiveSymbol, err })
      notify(`過去バーの取得に失敗しました(${tf})`, 'warn')
    } finally {
      historyLoadingRef.current[tf] = false
    }
  }, [sessionId, effectiveSymbol, notify])

  return { barsByTf, loadingByTf, currentPrice, reloadStack, loadMoreHistory }
}
