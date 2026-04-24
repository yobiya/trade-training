import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PostReviewResponse, StageEval } from '../api/client'

type Props = {
  sessionId: string
}

/**
 * 仕様書 §9.3: 事後 pips 数値のみを表示する。
 * 「機会損失/正解」等のラベル判定は結果バイアスを生むため採用しない(principles/no-tags)。
 */
function StageCell({ s }: { s: StageEval }) {
  return (
    <div className="stage-cell">
      <div className="stage-bars">{s.bars}本後</div>
      <div className="stage-pips">
        <span className="stage-up">↑{s.max_up_pips}</span>
        <span className="stage-down">↓{s.max_down_pips}</span>
      </div>
    </div>
  )
}

/**
 * 仕様書 §9.2 見送り事後検証 / §9.4 1 セッション単位の振り返り表示。
 * 層 1 候補・層 2 見送り・エントリー済みトレードそれぞれについて、
 * 10/50/200 本先の事後評価を表示する。
 */
export function PostReviewPanel({ sessionId }: Props) {
  const [data, setData] = useState<PostReviewResponse | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

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

  const hasAny = data && (data.candidates.length > 0 || data.skip !== null || data.entry !== null)

  return (
    <div className="post-review">
      <button
        className="post-review-toggle"
        onClick={() => setOpen(v => !v)}
        type="button"
      >
        振り返り(§9.2) {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="post-review-body">
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
                {data.entry.pips_pnl != null && (
                  <span className={`pnl ${data.entry.pips_pnl >= 0 ? 'profit' : 'loss'}`}>
                    {' '}{data.entry.pips_pnl > 0 ? '+' : ''}{data.entry.pips_pnl} pips
                  </span>
                )}
              </div>
              <div className="stage-row">
                {data.entry.stages.map(s => <StageCell key={s.bars} s={s} />)}
                {data.entry.stages.length === 0 && <span className="hint">事後データなし</span>}
              </div>
            </section>
          )}
          {data?.skip && (
            <section className="review-section">
              <h4>見送り(層 2): {data.skip.symbol}</h4>
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
