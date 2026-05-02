import { useState, useEffect, useCallback } from 'react'
import { api, ApiError } from '../api/client'
import type { SessionListItem } from '../api/client'
import { formatJST } from '../utils/datetime'

type Props = {
  onStartNew: (id: string) => void
  onOpenSession: (id: string) => void
  onLogout: () => void
}

/**
 * セッションはファイル管理で進行中 / 決着済みの 2 状態(§4.2.1)。
 * 削除はアプリ側で行わず OS / Dropbox 上のディレクトリ操作のみ(§13)。
 * 集計機能(勝率・期待値・スタイル別成績等)は principles/no-aggregation により採用しない。
 *
 * 仕様書 §4.1 Phase 1: ランダム範囲は backend の history_min_days / history_max_days で
 * 固定。提示時刻は JST 08:00 〜 翌 02:00 に限定(`_is_active_jst_hour` で実装)。期間 /
 * 曜日 / セッション(東京・ロンドン・NY)を絞り込む UI は持たない。
 */
export function SessionListPage({ onStartNew, onOpenSession, onLogout }: Props) {
  const [sessions, setSessions] = useState<SessionListItem[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await api.sessions.list()
      setSessions(list)
    } catch (err) {
      // I-11.6: mount 時取得失敗はデフォルト fallback(空一覧)+ ログのみ
      console.warn('[SessionListPage] sessions.list failed', err)
      setSessions([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate() {
    setCreating(true)
    setError(null)
    try {
      const s = await api.sessions.create()
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
      </div>

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
