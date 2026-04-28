import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TradeResponse, TradeSession } from '../api/client'

export type Phase = 'analyzing' | 'holding' | 'reviewing'

export type SessionFetchApi = {
  session: TradeSession | null
  setSession: (s: TradeSession | null) => void
  activeTrade: TradeResponse | null
  setActiveTrade: (t: TradeResponse | null) => void
  latestTrade: TradeResponse | null
  setLatestTrade: (t: TradeResponse | null) => void
  /** 3 つを並列再取得 */
  refresh: () => Promise<void>
  /** 派生: 現在のフェーズ */
  phase: Phase
}

/**
 * セッションの永続データ(session / activeTrade / latestTrade)+ phase 派生を集約する。
 * 設計 §E.4 / §B I-11(2026-04-29 で SessionPage から分離)。
 *
 * 失敗時は console.warn のみ(I-11.6 mount 時取得失敗 = ログのみ)。UI 呼び出し側で必要なら
 * `refresh()` の再実行 / 致命的なエラーは local `setError` で対応する。
 */
export function useSessionFetch(sessionId: string): SessionFetchApi {
  const [session, setSession] = useState<TradeSession | null>(null)
  const [activeTrade, setActiveTrade] = useState<TradeResponse | null>(null)
  const [latestTrade, setLatestTrade] = useState<TradeResponse | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [s, a, l] = await Promise.all([
        api.sessions.get(sessionId),
        api.trades.getActive(sessionId),
        api.trades.getLatest(sessionId),
      ])
      setSession(s)
      setActiveTrade(a)
      setLatestTrade(l)
    } catch (err) {
      console.warn('[useSessionFetch] refresh failed', { sessionId, err })
    }
  }, [sessionId])

  useEffect(() => { void refresh() }, [refresh])

  const phase: Phase = activeTrade
    ? 'holding'
    : (latestTrade && latestTrade.exit_time)
      ? 'reviewing'
      : 'analyzing'

  return {
    session, setSession,
    activeTrade, setActiveTrade,
    latestTrade, setLatestTrade,
    refresh,
    phase,
  }
}
