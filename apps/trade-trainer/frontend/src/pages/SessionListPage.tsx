import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '../api/client'
import type { SessionListItem } from '../api/client'
import { DAYS_OF_WEEK, TRADING_SESSIONS } from '../constants'
import { formatJST } from '../utils/datetime'

type Props = {
  onStartNew: (id: string) => void
  onOpenSession: (id: string) => void
  onLogout: () => void
}

/**
 * 仕様書 ver 1.45: セッションはファイル管理で進行中 / 決着済みの 2 状態。
 * 削除はアプリ側で行わず OS / Dropbox 上のディレクトリ操作のみ(§13)。
 * 集計機能(勝率・期待値・スタイル別成績等)は principles/no-aggregation により採用しない。
 */
export function SessionListPage({ onStartNew, onOpenSession, onLogout }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [creating, setCreating] = useState(false)
  const [showFilter, setShowFilter] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [days, setDays] = useState<number[]>([])
  const [sessionFilter, setSessionFilter] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const list = await api.sessions.list()
    setSessions(list)
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
    // 統合フロー(§6.1): 銘柄未確定でも同じ SessionPage を開く(分析中フェーズから再開)
    onOpenSession(s.id)
  }

  return (
    <div className="session-list-page">
      <header className="app-header">
        <h1>Trade Trainer</h1>
        <button onClick={onLogout} className="logout-btn">ログアウト</button>
      </header>

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
              {DAYS_OF_WEEK.map(d => (
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
              {TRADING_SESSIONS.map(s => (
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
            <span className={`session-name ${s.name ? '' : 'session-name-empty'}`}>
              {s.name || '(未命名)'}
            </span>
            <span className="session-symbol">{s.symbol || '分析中'}</span>
            <span className="session-date">{formatJST(s.presented_at)}</span>
            <span className={`session-pnl-r ${s.r_pnl == null ? 'aux' : (s.r_pnl >= 0 ? 'profit' : 'loss')}`}>
              {s.r_pnl == null
                ? '—'
                : `${s.r_pnl > 0 ? '+' : ''}${s.r_pnl.toFixed(2)}R`}
            </span>
            <span className={`status-badge ${s.is_settled ? 'settled' : ''}`}>
              {s.is_settled ? '決着済み' : '進行中'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
