import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TradeSession } from '../api/client'

const SYMBOLS = ['USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURGBP']

type Props = {
  sessionId: string
  onSelected: () => void
  onBack: () => void
}

export function SymbolPickPage({ sessionId, onSelected, onBack }: Props) {
  const [session, setSession] = useState<TradeSession | null>(null)
  const [picking, setPicking] = useState<string | null>(null)

  useEffect(() => {
    void api.sessions.get(sessionId).then(setSession)
  }, [sessionId])

  async function handlePick(symbol: string) {
    setPicking(symbol)
    try {
      await api.sessions.selectSymbol(sessionId, symbol)
      onSelected()
    } finally {
      setPicking(null)
    }
  }

  return (
    <div className="symbol-pick-page">
      <header className="app-header">
        <button onClick={onBack} className="back-btn">← 一覧</button>
        <h1>銘柄を選んでください</h1>
      </header>

      <div className="presented-datetime">
        <span className="label">提示日時:</span>
        <span className="value">
          {session?.presented_at
            ? new Date(session.presented_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
            : '—'}
        </span>
      </div>

      <p className="hint">この日時の相場を見て、優位性があると判断できる銘柄を 1 つ選んでください。</p>

      <div className="symbol-grid">
        {SYMBOLS.map(s => (
          <button
            key={s}
            className="symbol-btn"
            disabled={picking !== null}
            onClick={() => void handlePick(s)}
          >
            {picking === s ? '...' : s}
          </button>
        ))}
      </div>
    </div>
  )
}
