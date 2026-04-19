import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '../api/client'
import type { SessionListItem, StatsSummary } from '../api/client'
import { StatsBar } from '../components/StatsBar'
import { formatJST } from '../utils/datetime'

const DAYS = [
  { v: 0, label: '月' }, { v: 1, label: '火' }, { v: 2, label: '水' },
  { v: 3, label: '木' }, { v: 4, label: '金' }, { v: 5, label: '土' }, { v: 6, label: '日' },
]
const SESSIONS = [
  { v: 'tokyo', label: '東京 09-15' },
  { v: 'london', label: 'ロンドン 16-25' },
  { v: 'ny', label: 'NY 22-06' },
]

type Props = {
  onStartNew: (id: string) => void
  onOpenSession: (id: string) => void
  onLogout: () => void
}

export function SessionListPage({ onStartNew, onOpenSession, onLogout }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [stats, setStats] = useState<StatsSummary | null>(null)
  const [creating, setCreating] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [days, setDays] = useState<number[]>([])
  const [sessionFilter, setSessionFilter] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [list, statsRes] = await Promise.all([
      api.sessions.list(),
      api.stats.summary(),
    ])
    setSessions(list)
    setStats(statsRes)
  }, [])

  useEffect(() => { void load() }, [load])

  function toggleDay(v: number) {
    setDays(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }
  function toggleSession(v: string) {
    setSessionFilter(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v])
  }

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const filter = {
        date_from: dateFrom ? new Date(dateFrom).toISOString() : undefined,
        date_to: dateTo ? new Date(dateTo).toISOString() : undefined,
        days: days.length > 0 ? days : undefined,
        sessions: sessionFilter.length > 0 ? sessionFilter : undefined,
      }
      const s = await api.sessions.create(filter)
      onStartNew(s.id)
    } catch (e) {
      if (e instanceof ApiError) setError(e.message || 'エラーが発生しました')
      else throw e
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
        <button onClick={() => setShowFilter(v => !v)} className="filter-toggle">
          時間フィルタ {showFilter ? '▲' : '▼'}
        </button>
      </div>

      {showFilter && (
        <div className="time-filter">
          <div className="filter-row">
            <label>期間:</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            <span>〜</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <div className="filter-row">
            <label>曜日:</label>
            <div className="chip-group">
              {DAYS.map(d => (
                <button
                  key={d.v}
                  type="button"
                  className={`chip ${days.includes(d.v) ? 'active' : ''}`}
                  onClick={() => toggleDay(d.v)}
                >{d.label}</button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <label>時間帯:</label>
            <div className="chip-group">
              {SESSIONS.map(s => (
                <button
                  key={s.v}
                  type="button"
                  className={`chip ${sessionFilter.includes(s.v) ? 'active' : ''}`}
                  onClick={() => toggleSession(s.v)}
                >{s.label}</button>
              ))}
            </div>
          </div>
          <p className="filter-hint">未指定の項目は「全て」扱い。曜日・時間帯は JST 基準。</p>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

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
            <span className="session-date">{formatJST(s.presented_at)}</span>
            <span className={`session-status ${s.is_complete ? 'entered' : 'skip'}`}>
              {s.is_complete ? '完了' : s.symbol ? '未処理' : '銘柄未選定'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
