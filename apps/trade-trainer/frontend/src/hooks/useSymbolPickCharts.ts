import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { OhlcBar } from '../api/client'
import { BARS_BY_TF, SYMBOLS } from '../constants'

type BarsByTf = Record<string, OhlcBar[]>
type BarsMap = Record<string, BarsByTf>  // symbol -> tf -> bars

export type SymbolPickChartsApi = {
  /** symbol → tf → bars */
  barsByTf: BarsMap
  /** 各銘柄の直近変動率(D1 最新 2 本から近似)。未取得は undefined。 */
  changeBySymbol: Record<string, number | null>
  /** 指定銘柄 / TF の過去を追加取得 */
  loadMoreHistory: (symbol: string, tf: string, earliest: number) => Promise<void>
}

/**
 * 銘柄選定画面向けチャートデータフック。
 * - 現在表示中銘柄 + 可視 TF を優先取得
 * - 全銘柄の D1 を並列取得して直近変動率(サイドバー表示)を計算
 * - 他の銘柄に切替時はキャッシュ済みならそのまま、未取得分だけ fetch
 */
export function useSymbolPickCharts(
  sessionId: string,
  currentSymbol: string,
  visibleTfs: string[],
): SymbolPickChartsApi {
  const [barsByTf, setBarsByTf] = useState<BarsMap>({})
  const [changeBySymbol, setChangeBySymbol] = useState<Record<string, number | null>>({})
  const loadingRef = useRef<Set<string>>(new Set())  // "sym:tf"

  // 現在表示中銘柄の可視 TF を取得(不足分のみ)
  useEffect(() => {
    const missing = visibleTfs.filter(tf => {
      const cached = barsByTf[currentSymbol]?.[tf]
      return !cached || cached.length === 0
    })
    if (missing.length === 0) return
    const targets = missing.filter(tf => !loadingRef.current.has(`${currentSymbol}:${tf}`))
    targets.forEach(tf => loadingRef.current.add(`${currentSymbol}:${tf}`))
    void Promise.all(
      targets.map(tf => api.chart.get(sessionId, tf, BARS_BY_TF[tf] ?? 200, undefined, currentSymbol)),
    ).then(results => {
      setBarsByTf(prev => {
        const symMap = { ...(prev[currentSymbol] ?? {}) }
        targets.forEach((tf, i) => { symMap[tf] = results[i].bars })
        return { ...prev, [currentSymbol]: symMap }
      })
    }).finally(() => {
      targets.forEach(tf => loadingRef.current.delete(`${currentSymbol}:${tf}`))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, currentSymbol, visibleTfs.join(',')])

  // 直近変動率: 全銘柄の D1 を一度だけ取得
  useEffect(() => {
    void Promise.all(
      SYMBOLS.map(sym =>
        api.chart.get(sessionId, 'D1', 3, undefined, sym)
          .then(r => [sym, r.bars] as const)
          .catch(() => [sym, [] as OhlcBar[]] as const),
      ),
    ).then(pairs => {
      const changes: Record<string, number | null> = {}
      for (const [sym, bars] of pairs) {
        if (bars.length >= 2) {
          const prev = bars[bars.length - 2].c
          const last = bars[bars.length - 1].c
          changes[sym] = prev !== 0 ? (last - prev) / prev : null
        } else {
          changes[sym] = null
        }
      }
      setChangeBySymbol(changes)
    })
  }, [sessionId])

  const loadMoreHistory = useCallback(async (symbol: string, tf: string, earliest: number) => {
    const key = `${symbol}:${tf}:older`
    if (loadingRef.current.has(key)) return
    loadingRef.current.add(key)
    try {
      const res = await api.chart.get(sessionId, tf, BARS_BY_TF[tf] ?? 200, earliest, symbol)
      const newer = res.bars.filter(b => b.t < earliest)
      if (newer.length === 0) return
      setBarsByTf(prev => {
        const symMap = { ...(prev[symbol] ?? {}) }
        const existing = symMap[tf] ?? []
        const seen = new Set(existing.map(b => b.t))
        const fresh = newer.filter(b => !seen.has(b.t))
        symMap[tf] = [...fresh, ...existing]
        return { ...prev, [symbol]: symMap }
      })
    } finally {
      loadingRef.current.delete(key)
    }
  }, [sessionId])

  return { barsByTf, changeBySymbol, loadMoreHistory }
}
