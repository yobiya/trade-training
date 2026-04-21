import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { TradeSession } from '../api/client'
import { Chart } from '../components/Chart'
import type { ChartHandle } from '../components/Chart'
import { SYMBOLS, TIMEFRAMES, getTimeframeColor } from '../constants'
import { formatJST } from '../utils/datetime'
import { useSymbolPickCharts } from '../hooks/useSymbolPickCharts'

type Props = {
  sessionId: string
  onSelected: () => void
  onBack: () => void
}

/**
 * 仕様書 §6 銘柄選定画面
 * - 左サイドバー: 銘柄一覧(直近変動率・★マーク) + 候補メモ + 選定/見送りアクション
 * - メインエリア: 選択中銘柄の全 TF 縦積みチャート
 * - 「この銘柄で選定」→ 他候補の見送り理由確認フォーム(任意)
 * - 「全候補を見送り」→ セッション skip(自由記述、任意)
 */
export function SymbolPickPage({ sessionId, onSelected, onBack }: Props) {
  const [session, setSession] = useState<TradeSession | null>(null)
  const [currentSymbol, setCurrentSymbol] = useState(SYMBOLS[0])
  const [entryTf, setEntryTf] = useState('M5')
  const [hiddenTfs, setHiddenTfs] = useState<Set<string>>(new Set(['M30', 'H4']))
  const [skipReasonsDraft, setSkipReasonsDraft] = useState<Record<number, string>>({})
  const [confirming, setConfirming] = useState<'select' | 'skip-all' | null>(null)
  const [skipAllReason, setSkipAllReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api.sessions.get(sessionId).then(setSession)
  }, [sessionId])

  const candidates = session?.candidates ?? []
  const currentCandidate = useMemo(
    () => candidates.find(c => c.symbol === currentSymbol) ?? null,
    [candidates, currentSymbol],
  )

  const visibleTfs = useMemo(() => {
    const rest = TIMEFRAMES.filter(tf => tf !== entryTf && !hiddenTfs.has(tf))
    const head = hiddenTfs.has(entryTf) ? [] : [entryTf]
    return [...head, ...rest]
  }, [entryTf, hiddenTfs])

  const { barsByTf, changeBySymbol, loadMoreHistory } = useSymbolPickCharts(
    sessionId, currentSymbol, visibleTfs,
  )

  const [, setChartHandles] = useState<Map<string, ChartHandle>>(new Map())
  const chartRefCallbacksRef = useRef<Map<string, (h: ChartHandle | null) => void>>(new Map())
  const setChartRef = useCallback((tf: string) => {
    let cb = chartRefCallbacksRef.current.get(tf)
    if (!cb) {
      cb = (handle: ChartHandle | null) => {
        setChartHandles(prev => {
          const next = new Map(prev)
          if (handle) next.set(tf, handle)
          else next.delete(tf)
          return next
        })
      }
      chartRefCallbacksRef.current.set(tf, cb)
    }
    return cb
  }, [])

  function toggleTfVisibility(tf: string) {
    setHiddenTfs(prev => {
      const next = new Set(prev)
      if (next.has(tf)) next.delete(tf)
      else next.add(tf)
      return next
    })
  }

  async function refreshSession() {
    const s = await api.sessions.get(sessionId)
    setSession(s)
  }

  async function toggleCandidate() {
    if (!session) return
    setBusy(true)
    try {
      if (currentCandidate) {
        await api.sessions.deleteCandidate(sessionId, currentCandidate.id)
      } else {
        await api.sessions.addCandidate(sessionId, currentSymbol)
      }
      await refreshSession()
    } finally {
      setBusy(false)
    }
  }

  async function updateCurrentMemo(memo: string) {
    if (!currentCandidate) return
    setSession(s => s ? {
      ...s,
      candidates: s.candidates.map(c => c.id === currentCandidate.id ? { ...c, memo } : c),
    } : s)
    await api.sessions.updateCandidate(sessionId, currentCandidate.id, memo || null)
  }

  async function handleConfirmSelect() {
    if (!session) return
    setBusy(true)
    try {
      if (!currentCandidate) {
        await api.sessions.addCandidate(sessionId, currentSymbol)
      }
      const reasons = Object.fromEntries(
        Object.entries(skipReasonsDraft).map(([id, v]) => [Number(id), v || null]),
      )
      await api.sessions.selectSymbol(sessionId, currentSymbol, reasons)
      onSelected()
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  async function handleSkipAll() {
    setBusy(true)
    try {
      await api.sessions.skip(sessionId, skipAllReason || undefined)
      onBack()
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  const otherCandidates = candidates.filter(c => c.symbol !== currentSymbol)

  return (
    <div className="pick-page training-page">
      <header className="training-header">
        <button onClick={onBack} className="back-btn">← 一覧</button>
        <div className="session-info">
          <span className="symbol">{currentSymbol}</span>
          <span className="position">{formatJST(session?.presented_at, '')}</span>
        </div>
        <div className="tf-selector">
          <span className="tf-selector-label">エントリー足:</span>
          {TIMEFRAMES.map(tf => (
            <label key={`entry-${tf}`} className={`tf-entry-radio ${entryTf === tf ? 'active' : ''}`}>
              <input type="radio" name="entry-tf" checked={entryTf === tf} onChange={() => setEntryTf(tf)} />
              {tf}
            </label>
          ))}
          <span className="tf-selector-sep">|</span>
          <span className="tf-selector-label">表示:</span>
          {TIMEFRAMES.map(tf => (
            <label key={`show-${tf}`} className={`tf-show-check ${!hiddenTfs.has(tf) ? 'active' : ''}`}>
              <input type="checkbox" checked={!hiddenTfs.has(tf)} onChange={() => toggleTfVisibility(tf)} />
              {tf}
            </label>
          ))}
        </div>
      </header>

      <div className="training-body pick-body">
        <aside className="pick-sidebar">
          <p className="pick-hint">銘柄をクリックで切替、★ で候補追加</p>
          <div className="symbol-list">
            {SYMBOLS.map(sym => {
              const isCandidate = candidates.some(c => c.symbol === sym)
              const isActive = currentSymbol === sym
              const change = changeBySymbol[sym]
              const changeClass = change == null ? '' : change >= 0 ? 'up' : 'down'
              return (
                <button
                  key={sym}
                  className={`symbol-row ${isActive ? 'active' : ''}`}
                  onClick={() => setCurrentSymbol(sym)}
                >
                  <span className="sym-star">{isCandidate ? '★' : '☆'}</span>
                  <span className="sym-name">{sym}</span>
                  <span className={`sym-change ${changeClass}`}>
                    {change == null ? '—' : `${change >= 0 ? '+' : ''}${(change * 100).toFixed(2)}%`}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="pick-candidate-memo">
            <div className="pick-candidate-header">
              <span>候補メモ ({currentSymbol})</span>
              <button
                className={`star-btn ${currentCandidate ? 'on' : ''}`}
                onClick={() => void toggleCandidate()}
                disabled={busy}
              >
                {currentCandidate ? '★ 解除' : '☆ 追加'}
              </button>
            </div>
            <textarea
              className="pick-memo-textarea"
              placeholder={currentCandidate ? 'この候補の気づき(任意)' : '★を押すと候補に追加されメモできます'}
              value={currentCandidate?.memo ?? ''}
              onChange={e => void updateCurrentMemo(e.target.value)}
              disabled={!currentCandidate || busy}
              rows={5}
            />
            <div className="pick-candidate-count">候補数: {candidates.length}</div>
          </div>

          <div className="pick-actions">
            <button
              className="confirm-btn"
              onClick={() => setConfirming('select')}
              disabled={busy}
            >
              この銘柄で選定 →
            </button>
            <button
              className="skip-all-btn"
              onClick={() => setConfirming('skip-all')}
              disabled={busy}
            >
              全候補を見送り
            </button>
          </div>
        </aside>

        <div className="chart-area chart-stack">
          {visibleTfs.map(tf => (
            <div key={tf} className="stacked-chart">
              <div className="tf-badge" style={{ background: getTimeframeColor(tf) }}>{tf}</div>
              <Chart
                ref={setChartRef(tf)}
                bars={barsByTf[currentSymbol]?.[tf] ?? []}
                timeframe={tf}
                digits={session?.digits}
                onNeedMoreHistory={(earliest) => loadMoreHistory(currentSymbol, tf, earliest)}
              />
            </div>
          ))}
          {visibleTfs.length === 0 && (
            <div className="empty-chart-hint">表示する時間足を選択してください</div>
          )}
        </div>
      </div>

      {confirming === 'select' && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{currentSymbol} で選定</h2>
            {otherCandidates.length > 0 ? (
              <>
                <p className="modal-hint">他の候補を見送る理由を残せます(任意)。候補メモが入っていれば初期値として表示。</p>
                <div className="skip-reason-list">
                  {otherCandidates.map(c => (
                    <div key={c.id} className="skip-reason-row">
                      <label>{c.symbol}</label>
                      <textarea
                        rows={2}
                        placeholder="見送り理由(任意)"
                        defaultValue={c.memo ?? ''}
                        onChange={e => setSkipReasonsDraft(prev => ({ ...prev, [c.id]: e.target.value }))}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="modal-hint">他の候補はありません。確定しますか?</p>
            )}
            <div className="modal-actions">
              <button onClick={() => setConfirming(null)} disabled={busy}>キャンセル</button>
              <button className="primary" onClick={() => void handleConfirmSelect()} disabled={busy}>
                確定
              </button>
            </div>
          </div>
        </div>
      )}

      {confirming === 'skip-all' && (
        <div className="modal-backdrop" onClick={() => setConfirming(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>全候補を見送り</h2>
            <p className="modal-hint">見送り理由(任意)</p>
            <textarea
              rows={3}
              value={skipAllReason}
              onChange={e => setSkipAllReason(e.target.value)}
              placeholder="優位性のある銘柄が見つからなかった 等"
            />
            <div className="modal-actions">
              <button onClick={() => setConfirming(null)} disabled={busy}>キャンセル</button>
              <button className="primary" onClick={() => void handleSkipAll()} disabled={busy}>
                見送り確定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
