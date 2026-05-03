import { useCallback, useState } from 'react'
import { api } from '../api/client'
import type { TradeResponse, TradeSession } from '../api/client'
import { useNotify } from './useNotify'

export type EntryDraft = { sl: number | null; tp: number | null }

export type TradeFlowApi = {
  entryDraft: EntryDraft
  setEntryDraft: React.Dispatch<React.SetStateAction<EntryDraft>>
  entryPlacing: 'sl' | 'tp' | null
  setEntryPlacing: (v: 'sl' | 'tp' | null) => void
  advancing: boolean
  loading: boolean
  handleEnter: (args: { direction: 'buy' | 'sell'; price: number; sl: number; tp: number | undefined }) => Promise<void>
  handleExit: (price: number, reason: string) => Promise<void>
  handleAdvance: (n?: number) => Promise<void>
  handleSkip: (reason: string | undefined) => Promise<void>
}

type Params = {
  sessionId: string
  currentSymbol: string
  /** §5.1.5 フォーカス TF: advance 単位 / エントリー時の Trade.entry_tf として使う */
  focusedTf: string
  reloadStack: () => Promise<void>
  setSession: (s: TradeSession | null) => void
  setActiveTrade: (t: TradeResponse | null) => void
  setLatestTrade: (t: TradeResponse | null) => void
}

/**
 * トレード操作系(エントリー draft / advance / 決済 / 見送り)を集約する hook(設計 §E.4 / §B I-11)。
 * 内部で `useNotify()` を呼んで成功 / 失敗を通知する(I-11.4 ユーザー入力起因の失敗 → notify)。
 *
 * `useSessionFetch` の setter は **props 注入** で受ける(双方向依存を避けるため)。
 */
export function useTradeFlow({
  sessionId, currentSymbol, focusedTf,
  reloadStack, setSession, setActiveTrade, setLatestTrade,
}: Params): TradeFlowApi {
  const { notify } = useNotify()
  const [entryDraft, setEntryDraft] = useState<EntryDraft>({ sl: null, tp: null })
  const [entryPlacing, setEntryPlacing] = useState<'sl' | 'tp' | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const [loading, setLoading] = useState(false)

  const refreshSession = useCallback(async () => {
    try {
      const s = await api.sessions.get(sessionId)
      setSession(s)
    } catch (err) {
      console.warn('[useTradeFlow] sessions.get failed', err)
    }
  }, [sessionId, setSession])

  const handleEnter = useCallback<TradeFlowApi['handleEnter']>(async (args) => {
    setLoading(true)
    try {
      const trade = await api.trades.enter(sessionId, {
        symbol: currentSymbol,
        direction: args.direction,
        entry_tf: focusedTf,
        price: args.price,
        sl: args.sl,
        tp: args.tp,
      })
      setActiveTrade(trade)
      setLatestTrade(trade)
      setEntryDraft({ sl: null, tp: null })
      setEntryPlacing(null)
      await refreshSession()
      notify(`エントリー: ${args.direction.toUpperCase()} ${currentSymbol} @ ${args.price}`, 'info')
    } catch (err) {
      console.warn('[useTradeFlow] enter failed', err)
      notify('エントリーに失敗しました。バックエンド接続を確認してください', 'error')
    } finally {
      setLoading(false)
    }
  }, [sessionId, currentSymbol, focusedTf, refreshSession, setActiveTrade, setLatestTrade, notify])

  const handleExit = useCallback<TradeFlowApi['handleExit']>(async (price, reason) => {
    setLoading(true)
    try {
      const trade = await api.trades.exit(sessionId, { price, reason })
      setActiveTrade(null)
      setLatestTrade(trade)
      const pips = trade.pips_pnl ?? 0
      notify(`決済: ${price} (${pips > 0 ? '+' : ''}${pips} pips)`, 'info')
    } catch (err) {
      console.warn('[useTradeFlow] exit failed', err)
      notify('決済に失敗しました', 'error')
    } finally {
      setLoading(false)
    }
  }, [sessionId, setActiveTrade, setLatestTrade, notify])

  const handleAdvance = useCallback<TradeFlowApi['handleAdvance']>(async (n = 1) => {
    setAdvancing(true)
    try {
      // 仕様 §5.1.1: 「+N 本」はフォーカス TF の N バー = 次の N 本目のフォーカス TF 境界へ進む。
      // backend で focused_tf を使って境界アライメント + 市場クローズスキップを行う。
      const res = await api.chart.advance(sessionId, n, focusedTf, currentSymbol)
      await reloadStack()
      if (res.trade_auto_closed) {
        const pips = res.trade_pips_pnl ?? 0
        notify(
          `自動決済: ${res.trade_exit_reason?.toUpperCase()} @ ${res.trade_exit_price} (${pips > 0 ? '+' : ''}${pips} pips)`,
          'info',
        )
        const closed = await api.trades.getLatest(sessionId)
        setLatestTrade(closed)
        setActiveTrade(null)
      }
      await refreshSession()
    } catch (err) {
      console.warn('[useTradeFlow] advance failed', err)
      notify('足進めに失敗しました', 'error')
    } finally {
      setAdvancing(false)
    }
  }, [sessionId, currentSymbol, focusedTf, reloadStack, refreshSession, setActiveTrade, setLatestTrade, notify])

  const handleSkip = useCallback<TradeFlowApi['handleSkip']>(async (reason) => {
    try {
      await api.sessions.skip(sessionId, reason)
      await refreshSession()
      notify('見送り確定 — 振り返りメモを書くと決着済みに自動遷移します', 'info')
    } catch (err) {
      console.warn('[useTradeFlow] skip failed', err)
      notify('見送り確定に失敗しました', 'error')
    }
  }, [sessionId, refreshSession, notify])

  return {
    entryDraft, setEntryDraft,
    entryPlacing, setEntryPlacing,
    advancing, loading,
    handleEnter, handleExit, handleAdvance, handleSkip,
  }
}
