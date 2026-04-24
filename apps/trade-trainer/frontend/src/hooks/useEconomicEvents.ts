import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { EconomicEvent } from '../api/types'

/**
 * 銘柄ペアから関連通貨を抽出する(USDJPY → [USD, JPY])。
 * 仕様書 §5.4: 表示銘柄ペアの通貨 + USD(基軸通貨)を既定で表示する。
 */
function currenciesForSymbol(symbol: string | null | undefined): string[] {
  if (!symbol || symbol.length < 6) return ['USD']
  const base = symbol.slice(0, 3).toUpperCase()
  const quote = symbol.slice(3, 6).toUpperCase()
  const set = new Set<string>([base, quote, 'USD'])
  return Array.from(set)
}

/**
 * セッションの表示期間内で絞った経済指標を取得する(仕様書 §5.4)。
 * 銘柄が変わったら関連通貨を自動で切り替える。
 */
export function useEconomicEvents(params: {
  sessionId: string
  symbol: string | null | undefined
  fromUnix: number | null
  toUnix: number | null
  importanceMin?: number
  enabled?: boolean
}): { events: EconomicEvent[]; reload: () => Promise<void> } {
  const { sessionId, symbol, fromUnix, toUnix, importanceMin = 3, enabled = true } = params
  const [events, setEvents] = useState<EconomicEvent[]>([])

  const reload = useCallback(async () => {
    if (!enabled || fromUnix === null || toUnix === null) {
      setEvents([])
      return
    }
    try {
      const list = await api.events.list(sessionId, fromUnix, toUnix, {
        currencies: currenciesForSymbol(symbol),
        importanceMin,
      })
      setEvents(list)
    } catch {
      setEvents([])
    }
  }, [sessionId, symbol, fromUnix, toUnix, importanceMin, enabled])

  useEffect(() => { void reload() }, [reload])

  return { events, reload }
}
