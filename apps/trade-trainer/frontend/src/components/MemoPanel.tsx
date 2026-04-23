import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { SessionCandidate, TradeSession } from '../api/client'
import { Modal } from './Modal'

type Props = {
  session: TradeSession
  /** 初期表示する銘柄別メモの対象 symbol。銘柄選定画面なら現在表示中の銘柄。 */
  initialSymbol?: string | null
  onClose: () => void
  onChange: (next: TradeSession) => void
}

/**
 * 仕様書 §7.3 メモパネル切替式 UI。
 * 上段: 銘柄別メモ(SessionCandidate.memo、ドロップダウンで銘柄切替)
 * 下段: 横断メモ(Session.note)
 * 両方とも自由記述。デバウンス保存。
 */
export function MemoPanel({ session, initialSymbol, onClose, onChange }: Props) {
  const candidates = session.candidates ?? []
  const initial = initialSymbol ?? candidates[0]?.symbol ?? ''
  const [selectedSymbol, setSelectedSymbol] = useState<string>(initial)
  const currentCandidate = useMemo(
    () => candidates.find(c => c.symbol === selectedSymbol) ?? null,
    [candidates, selectedSymbol],
  )
  const [noteDraft, setNoteDraft] = useState<string>(session.note ?? '')
  const [memoDraft, setMemoDraft] = useState<string>(currentCandidate?.memo ?? '')

  // 銘柄切替で現在候補の memo 初期値をリセット
  useEffect(() => {
    setMemoDraft(currentCandidate?.memo ?? '')
  }, [currentCandidate?.id])

  // 横断メモの debounce 保存
  const noteTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current)
    if (noteDraft === (session.note ?? '')) return
    noteTimerRef.current = window.setTimeout(() => {
      void api.sessions.updateNote(session.id, noteDraft || null).then(onChange)
    }, 500)
    return () => {
      if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current)
    }
  }, [noteDraft, session.id, session.note, onChange])

  // 銘柄別メモの debounce 保存
  const memoTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (memoTimerRef.current) window.clearTimeout(memoTimerRef.current)
    if (currentCandidate == null) return
    if (memoDraft === (currentCandidate.memo ?? '')) return
    memoTimerRef.current = window.setTimeout(() => {
      void api.sessions.updateCandidate(session.id, currentCandidate.id, memoDraft || null).then(() => {
        // refresh session to reflect updated candidate memo
        void api.sessions.get(session.id).then(onChange)
      })
    }, 500)
    return () => {
      if (memoTimerRef.current) window.clearTimeout(memoTimerRef.current)
    }
  }, [memoDraft, currentCandidate?.id, currentCandidate?.memo, session.id, onChange])

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const candidateList = candidates

  return (
    <Modal onClose={onClose}>
      <div className="memo-panel">
        <div className="memo-panel-header">
          <h2>📝 メモ</h2>
          <button onClick={onClose} className="memo-close-btn" aria-label="閉じる">×</button>
        </div>

        <section className="memo-section">
          <div className="memo-section-header">
            <label>銘柄別メモ</label>
            {candidateList.length > 0 ? (
              <select
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value)}
                className="memo-symbol-select"
              >
                {candidateList.map((c: SessionCandidate) => (
                  <option key={c.id} value={c.symbol}>
                    {c.is_selected ? '★ ' : ''}{c.symbol}
                  </option>
                ))}
              </select>
            ) : (
              <span className="memo-empty-hint">候補なし(銘柄選定画面で ★ を押すと候補に追加されます)</span>
            )}
          </div>
          <textarea
            className="memo-textarea memo-candidate-textarea"
            value={memoDraft}
            onChange={e => setMemoDraft(e.target.value)}
            placeholder="この銘柄のチャート観察・根拠・個別判断を自由に"
            disabled={currentCandidate == null}
            rows={10}
          />
        </section>

        <section className="memo-section">
          <div className="memo-section-header">
            <label>横断メモ(相場観・比較・シナリオ・振り返り)</label>
          </div>
          <textarea
            className="memo-textarea memo-note-textarea"
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            placeholder="通貨強弱・銘柄比較・相場観・シナリオ・見送り理由・決済所感・振り返りなど、セッション全体にまたがる思考"
            rows={16}
          />
        </section>
      </div>
    </Modal>
  )
}
