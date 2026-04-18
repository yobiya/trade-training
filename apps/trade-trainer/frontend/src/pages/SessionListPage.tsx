import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { TradeSession, StatsSummary } from '../api/client'
import { StatsBar } from '../components/StatsBar'

const SYMBOLS = ['USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURGBP']

type Props = {
  onSelectSession: (id: string) => void
  onLogout: () => void
}

export function SessionListPage({ onSelectSession, onLogout }: Props) {
  const [sessions, setSessions] = useState<TradeSession[]>([])
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [symbol, setSymbol] = useState('USDJPY')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const [listRes, statsRes] = await Promise.all([
      api.sessions.list(),
      api.stats.summary(),
    ])
    setSessions(listRes.items)
    setStats(statsRes)
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate() {
    setCreating(true)
    try {
      const s = await api.sessions.create(symbol)
      onSelectSession(s.id)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="session-list-page">
      <header className="app-header">
        <h1>Trade Trainer</h1>
        <button onClick={onLogout} className="logout-btn">ログアウト</button>
      </header>

      <StatsBar stats={stats} />

      <div className="new-session">
        <select value={symbol} onChange={e => setSymbol(e.target.value)}>
          {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => void handleCreate()} disabled={creating} className="create-btn">
          {creating ? '作成中...' : '新規セッション'}
        </button>
      </div>

      <div className="session-list">
        {sessions.length === 0 && (
          <p className="empty">セッションがありません。新規セッションを作成してください。</p>
        )}
        {sessions.map(s => (
          <div
            key={s.id}
            className="session-item"
            onClick={() => onSelectSession(s.id)}
          >
            <span className="session-symbol">{s.symbol ?? '—'}</span>
            <span className="session-date">{new Date(s.presented_at).toLocaleDateString('ja-JP')}</span>
            <span className={`session-status ${s.has_entry ? 'entered' : 'skip'}`}>
              {s.has_entry === null ? '未処理' : s.has_entry ? 'エントリー' : '見送り'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
