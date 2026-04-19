import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { SessionListItem, StatsSummary } from '../api/client'
import { StatsBar } from '../components/StatsBar'

type Props = {
  onStartNew: (id: string) => void
  onOpenSession: (id: string) => void
  onLogout: () => void
}

export function SessionListPage({ onStartNew, onOpenSession, onLogout }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const [list, statsRes] = await Promise.all([
      api.sessions.list(),
      api.stats.summary(),
    ])
    setSessions(list)
    setStats(statsRes)
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate() {
    setCreating(true)
    try {
      const s = await api.sessions.create()
      onStartNew(s.id)
    } finally {
      setCreating(false)
    }
  }

  function handleOpenSession(s: SessionListItem) {
    if (!s.symbol) {
      onStartNew(s.id)
    } else {
      onOpenSession(s.id)
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
        <button onClick={() => void handleCreate()} disabled={creating} className="create-btn">
          {creating ? '作成中...' : '新規セッション(日時を抽選)'}
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
            onClick={() => handleOpenSession(s)}
          >
            <span className="session-symbol">{s.symbol || '銘柄未選定'}</span>
            <span className="session-date">
              {new Date(s.presented_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            </span>
            <span className={`session-status ${s.is_complete ? 'entered' : 'skip'}`}>
              {s.is_complete ? '完了' : s.symbol ? '未処理' : '銘柄未選定'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
