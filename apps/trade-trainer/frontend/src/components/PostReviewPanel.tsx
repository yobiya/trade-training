import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { EntryReview, PostReviewResponse, StageEval, TradeSession } from '../api/client'

type Props = {
  session: TradeSession
  onSessionChange: (next: TradeSession) => void
}

function formatR(r: number | null): string {
  if (r === null) return '—'
  const sign = r > 0 ? '+' : ''
  return `${sign}${r.toFixed(2)}R`
}

function formatPips(p: number | null): string {
  if (p === null) return '—'
  return `${p.toFixed(1)}pips`
}

/**
 * 仕様書 §9.3: 事後 R を主表示 + pips 補助。
 * ラベル判定(機会損失/正解)は採用しない(principles/no-tags)。
 */
function StageCell({ s }: { s: StageEval }) {
  const hasR = s.max_up_r !== null && s.max_down_r !== null
  return (
    <div className="stage-cell">
      <div className="stage-bars">{s.bars}本後</div>
      {hasR ? (
        <>
          <div className="stage-r">
            <span className="stage-up">↑{s.max_up_r!.toFixed(2)}R</span>
            <span className="stage-down">↓{s.max_down_r!.toFixed(2)}R</span>
          </div>
          <div className="stage-pips-aux">
            (↑{s.max_up_pips.toFixed(1)} ↓{s.max_down_pips.toFixed(1)} pips)
          </div>
        </>
      ) : (
        <div className="stage-pips">
          <span className="stage-up">↑{s.max_up_pips.toFixed(1)}</span>
          <span className="stage-down">↓{s.max_down_pips.toFixed(1)}</span>
          <span className="stage-pips-unit">pips</span>
        </div>
      )}
    </div>
  )
}

/**
 * §9.5 エントリー結果セクション: 実損益 R / MFE / MAE / 続き観察表示。
 */
function EntryResultBlock({ e }: { e: EntryReview }) {
  const rUnit = e.r_unit_pips
  return (
    <div className="entry-result">
      <div className="entry-result-row">
        <span className="entry-result-label">実損益</span>
        <span className={`entry-result-value ${(e.r_pnl ?? 0) >= 0 ? 'profit' : 'loss'}`}>
          {formatR(e.r_pnl)}
          {e.pips_pnl != null && <span className="aux"> ({e.pips_pnl > 0 ? '+' : ''}{e.pips_pnl}pips)</span>}
        </span>
      </div>
      <div className="entry-result-row">
        <span className="entry-result-label">MFE(最大順行)</span>
        <span className="entry-result-value profit">
          {formatR(e.mfe_r)}
          {e.mfe_pips != null && <span className="aux"> ({formatPips(e.mfe_pips)})</span>}
        </span>
      </div>
      <div className="entry-result-row">
        <span className="entry-result-label">MAE(最大逆行)</span>
        <span className="entry-result-value loss">
          {formatR(e.mae_r)}
          {e.mae_pips != null && <span className="aux"> ({formatPips(e.mae_pips)})</span>}
        </span>
      </div>
      {rUnit != null && (
        <div className="entry-result-row aux">
          <span className="entry-result-label">R 基準</span>
          <span>SL 幅 {rUnit.toFixed(1)}pips = 1R</span>
        </div>
      )}
      {e.continuation_available && (
        <div className="entry-result-row aux">
          <span className="entry-result-label">続き観察</span>
          <span>決済後 {e.continuation_bars} 本分 ▶ で進行可能</span>
        </div>
      )}
    </div>
  )
}

/**
 * 仕様書 §9 判断結果の事後確認機能。
 * 層 1 候補・層 2 見送り・エントリー済みトレードそれぞれについて、R 主表示で事後評価を提示する。
 */
export function PostReviewPanel({ session, onSessionChange }: Props) {
  const sessionId = session.id
  const [data, setData] = useState<PostReviewResponse | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [noteDraft, setNoteDraft] = useState<string>(session.note ?? '')
  const noteTimerRef = useRef<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(await api.sessions.postReview(sessionId))
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    if (open && data === null && !loading) void load()
  }, [open, data, loading, load])

  // session.note の外部更新(MemoPanel など)を反映
  useEffect(() => {
    setNoteDraft(session.note ?? '')
  }, [session.note])

  // 振り返りメモ debounce 保存(§4.2.2: 横断メモ非空で settled_at が自動セット)
  useEffect(() => {
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current)
    if (noteDraft === (session.note ?? '')) return
    noteTimerRef.current = window.setTimeout(() => {
      void api.sessions.updateNote(sessionId, noteDraft || null).then(onSessionChange)
    }, 500)
    return () => {
      if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current)
    }
  }, [noteDraft, sessionId, session.note, onSessionChange])

  const hasAny = data && (data.candidates.length > 0 || data.skip !== null || data.entry !== null)

  return (
    <div className="post-review">
      <button
        className="post-review-toggle"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        振り返り(§9) {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="post-review-body">
          <section className="review-section review-memo-section">
            <div className="review-memo-header">
              <h4>振り返りメモ</h4>
              <span className={`review-memo-status ${session.is_settled ? 'settled' : 'pending'}`}>
                {session.is_settled ? '決着済み' : '未記入 → 決着済みに自動遷移'}
              </span>
            </div>
            <p className="hint review-memo-hint">
              ここに記入すると横断メモ(§7.3)として保存され、§4.2.2 により決着済みに自動遷移します。
              通貨強弱・銘柄比較・シナリオ・決済所感など、セッション全体の思考を残してください。
            </p>
            <textarea
              className="memo-textarea review-memo-textarea"
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              placeholder="今回の判断結果から学んだこと・次に活かすこと"
              rows={6}
            />
          </section>

          {loading && <p className="hint">読み込み中...</p>}
          {!loading && !hasAny && (
            <p className="hint">見送り・エントリー共に未確定のため、振り返りできる対象がありません。</p>
          )}
          {data?.entry && (
            <section className="review-section">
              <h4>エントリー結果: {data.entry.symbol} ({data.entry.direction.toUpperCase()})</h4>
              <div className="review-meta">
                @ {data.entry.entry_price}
                {data.entry.sl != null && <> / SL {data.entry.sl}</>}
                {data.entry.tp != null && <> / TP {data.entry.tp}</>}
              </div>
              <EntryResultBlock e={data.entry} />
              <div className="review-subheader">起点 (presented_at) からの事後</div>
              <div className="stage-row">
                {data.entry.stages.map(s => <StageCell key={s.bars} s={s} />)}
                {data.entry.stages.length === 0 && <span className="hint">事後データなし</span>}
              </div>
            </section>
          )}
          {data?.skip && (
            <section className="review-section">
              <h4>見送り(層 2)</h4>
              {data.skip.reason && <div className="review-meta">{data.skip.reason}</div>}
              <div className="stage-row">
                {data.skip.stages.map(s => <StageCell key={s.bars} s={s} />)}
                {data.skip.stages.length === 0 && <span className="hint">事後データなし</span>}
              </div>
            </section>
          )}
          {data && data.candidates.length > 0 && (
            <section className="review-section">
              <h4>外した候補(層 1)</h4>
              {data.candidates.map(c => (
                <div key={c.symbol} className="review-candidate">
                  <div className="review-meta">
                    <strong>{c.symbol}</strong>
                    {c.skip_reason && <span className="review-reason"> — {c.skip_reason}</span>}
                  </div>
                  <div className="stage-row">
                    {c.stages.map(s => <StageCell key={s.bars} s={s} />)}
                    {c.stages.length === 0 && <span className="hint">事後データなし</span>}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
