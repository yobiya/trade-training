import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Drawing, TradeResponse, TradeSession } from '../api/client'
import { Chart } from '../components/Chart'
import type { PriceLine } from '../components/Chart'
import { DrawingOverlay } from '../components/DrawingOverlay'
import { DrawingTools } from '../components/DrawingTools'
import { IndicatorPanel } from '../components/IndicatorPanel'
import { MemoPanel } from '../components/MemoPanel'
import { Modal } from '../components/Modal'
import { PostReviewPanel } from '../components/PostReviewPanel'
import { SkipEntryModal } from '../components/SkipEntryModal'
import { TimeframeSelector } from '../components/TimeframeSelector'
import { TradePanel } from '../components/TradePanel'
import type { IndicatorConfig } from '../indicators/types'
import { SYMBOLS, TIMEFRAMES, getTimeframeColor } from '../constants'
import type { ChartApi, CreateDrawingBody, UpdateDrawingPatch } from '../drawing/types'
import { isDrawingVisibleOnTf } from '../drawing/visibility'
import { useChartRefCache } from '../hooks/useChartRefCache'
import { useCharts } from '../hooks/useCharts'
import { useDrawings } from '../hooks/useDrawings'
import { useDrawingInteraction } from '../hooks/useDrawingInteraction'
import { useTradingStyles } from '../hooks/useTradingStyles'
import { formatJST } from '../utils/datetime'

type Props = {
  sessionId: string
  onBack: () => void
}

type Phase = 'analyzing' | 'holding' | 'reviewing'

function priceLinesForTf(drawings: Drawing[], tf: string, preview: Drawing | null): PriceLine[] {
  return drawings
    .filter(d => d.kind === 'line' && isDrawingVisibleOnTf(d, tf))
    .map(d => {
      const previewMatch = preview?.id === d.id ? preview : null
      return {
        id: d.id,
        price: Number(previewMatch?.data.price ?? d.data.price),
        label: d.label ?? undefined,
        color: getTimeframeColor(d.timeframe),
      }
    })
}

/**
 * 仕様書 §6.1 統合フロー: 1 画面で分析 → エントリー → 保有 → 振り返り を通す。
 * - 分析中: 銘柄切替・描画・インジ・時間進行・メモ・★ 候補・エントリー・見送り
 * - 保有中: 銘柄は Trade.symbol に固定、時間進行 / 決済
 * - 振り返り: Trade 結果 + PostReviewPanel、続き観察のために時間進行継続可能
 */
export function SessionPage({ sessionId, onBack }: Props) {
  const [session, setSession] = useState<TradeSession | null>(null)
  const [activeTrade, setActiveTrade] = useState<TradeResponse | null>(null)
  const [latestTrade, setLatestTrade] = useState<TradeResponse | null>(null)

  // 分析フェーズで表示中の銘柄。エントリー後は Trade.symbol に固定される。
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string>(SYMBOLS[0])

  const [entryTf, setEntryTf] = useState('M5')
  const [activeTf, setActiveTf] = useState('M5')
  const [hiddenTfs, setHiddenTfs] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const [indicators, setIndicators] = useState<IndicatorConfig[]>([])
  const [skipping, setSkipping] = useState(false)
  const [memoOpen, setMemoOpen] = useState(false)
  const [confirmSkipAll, setConfirmSkipAll] = useState(false)
  const [skipAllReasonDraft, setSkipAllReasonDraft] = useState('')

  // フェーズ判定
  const phase: Phase = activeTrade
    ? 'holding'
    : (latestTrade && latestTrade.exit_time)
      ? 'reviewing'
      : 'analyzing'

  // 現在の対象銘柄
  const currentSymbol = phase === 'analyzing'
    ? analyzingSymbol
    : (activeTrade?.symbol ?? latestTrade?.symbol ?? analyzingSymbol)

  // 表示順序: エントリー足を最上段
  const visibleTfs = useMemo(() => {
    const rest = TIMEFRAMES.filter(tf => tf !== entryTf && !hiddenTfs.has(tf))
    const head = hiddenTfs.has(entryTf) ? [] : [entryTf]
    return [...head, ...rest]
  }, [entryTf, hiddenTfs])

  const { barsByTf, currentPrice, reloadAll, loadMoreHistory } = useCharts(
    sessionId, currentSymbol, visibleTfs, entryTf,
  )
  const { drawings, add: addDrawing, update: updateDrawing, remove: removeDrawing } =
    useDrawings(sessionId, currentSymbol)
  const tradingStyles = useTradingStyles()

  const { handles: chartHandles, setRef: setChartRef } = useChartRefCache()
  const chartApiRef = useRef<ChartApi | null>(null)

  function handleChartMouseEnter(tf: string) {
    setActiveTf(tf)
    chartApiRef.current = chartHandles.get(tf)?.api ?? null
  }

  function toggleTfVisibility(tf: string) {
    setHiddenTfs(prev => {
      const next = new Set(prev)
      if (next.has(tf)) next.delete(tf)
      else next.add(tf)
      return next
    })
  }

  const handleCreateDrawing = useCallback(async (body: CreateDrawingBody): Promise<Drawing> => {
    return addDrawing(body)
  }, [addDrawing])

  const handleUpdateDrawing = useCallback(async (id: number, patch: UpdateDrawingPatch) => {
    await updateDrawing(id, patch)
  }, [updateDrawing])

  const handleDeleteDrawing = useCallback(async (id: number) => {
    await removeDrawing(id)
  }, [removeDrawing])

  const interaction = useDrawingInteraction({
    drawings,
    activeTimeframe: activeTf,
    chartApiRef,
    onCreate: handleCreateDrawing,
    onUpdate: handleUpdateDrawing,
    onDelete: handleDeleteDrawing,
  })

  function notify(msg: string) {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  useEffect(() => {
    void api.sessions.get(sessionId).then(setSession)
    void api.trades.getActive(sessionId).then(setActiveTrade)
    void api.trades.getLatest(sessionId).then(setLatestTrade)
  }, [sessionId])

  // 仕様書 §7.3: M キーでメモパネルをトグル
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'm' && e.key !== 'M') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      setMemoOpen(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleAdvance(n: number = 1) {
    setAdvancing(true)
    try {
      const res = await api.chart.advance(sessionId, n)
      await reloadAll()
      if (res.trade_auto_closed) {
        const pips = res.trade_pips_pnl ?? 0
        notify(`自動決済: ${res.trade_exit_reason?.toUpperCase()} @ ${res.trade_exit_price} (${pips > 0 ? '+' : ''}${pips} pips)`)
        const closed = await api.trades.getLatest(sessionId)
        setLatestTrade(closed)
        setActiveTrade(null)
      }
      const s = await api.sessions.get(sessionId)
      setSession(s)
    } finally {
      setAdvancing(false)
    }
  }

  async function handleEnter(args: {
    direction: 'buy' | 'sell'
    price: number
    sl: number
    tp: number | undefined
    styleId: string
  }) {
    setLoading(true)
    try {
      const trade = await api.trades.enter(sessionId, {
        symbol: currentSymbol,
        direction: args.direction,
        price: args.price,
        sl: args.sl,
        tp: args.tp,
        style_id: args.styleId,
      })
      setActiveTrade(trade)
      setLatestTrade(trade)
      const s = await api.sessions.get(sessionId)
      setSession(s)
      notify(`エントリー: ${args.direction.toUpperCase()} ${currentSymbol} @ ${args.price}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleExit(price: number, reason: string) {
    setLoading(true)
    try {
      const trade = await api.trades.exit(sessionId, { price, reason })
      setActiveTrade(null)
      setLatestTrade(trade)
      const pips = trade.pips_pnl ?? 0
      notify(`決済: ${price} (${pips > 0 ? '+' : ''}${pips} pips)`)
    } finally {
      setLoading(false)
    }
  }

  async function handleSkipConfirm(reason: string, consideredStyles: string[]) {
    await api.sessions.skip(sessionId, reason, consideredStyles)
    const s = await api.sessions.get(sessionId)
    setSession(s)
    setSkipping(false)
    notify('見送り確定 — 振り返りが終わったら「セッションを閉じる」')
  }

  async function handleSkipAllConfirm() {
    await api.sessions.skip(sessionId, skipAllReasonDraft || undefined)
    const s = await api.sessions.get(sessionId)
    setSession(s)
    setConfirmSkipAll(false)
    setSkipAllReasonDraft('')
    notify('全候補を見送り — 振り返りが終わったら「セッションを閉じる」')
  }

  async function handleCloseSession() {
    const ok = window.confirm('このセッションを閉じて破棄します。振り返りメモ・AI 分析結果・描画も削除されます。よろしいですか?')
    if (!ok) return
    await api.sessions.close(sessionId)
    onBack()
  }

  async function toggleCandidate() {
    if (!session) return
    const existing = session.candidates.find(c => c.symbol === currentSymbol)
    if (existing) {
      await api.sessions.deleteCandidate(sessionId, existing.id)
    } else {
      await api.sessions.addCandidate(sessionId, currentSymbol)
    }
    const s = await api.sessions.get(sessionId)
    setSession(s)
  }

  const candidates = session?.candidates ?? []
  const isCurrentStar = candidates.some(c => c.symbol === currentSymbol)

  return (
    <div className="training-page session-page">
      <header className="training-header">
        <button onClick={onBack} className="back-btn">← 一覧</button>
        <div className="session-info">
          {phase === 'analyzing' ? (
            <select
              className="symbol-dropdown"
              value={currentSymbol}
              onChange={e => setAnalyzingSymbol(e.target.value)}
            >
              {SYMBOLS.map(sym => {
                const star = candidates.some(c => c.symbol === sym) ? '★ ' : ''
                return <option key={sym} value={sym}>{star}{sym}</option>
              })}
            </select>
          ) : (
            <span className="symbol">{currentSymbol}</span>
          )}
          <span className="phase-badge">
            {phase === 'analyzing' ? '分析中' : phase === 'holding' ? '保有中' : '振り返り'}
          </span>
          <span className="position">{formatJST(session?.current_position, '')}</span>
        </div>
        <TimeframeSelector
          entryTf={entryTf}
          onEntryChange={setEntryTf}
          hiddenTfs={hiddenTfs}
          onToggleVisibility={toggleTfVisibility}
        />
        <button
          onClick={() => setMemoOpen(v => !v)}
          className="memo-open-btn"
          title="M キーでも開閉できます"
        >
          📝 メモ
        </button>
      </header>

      {notification && <div className="notification">{notification}</div>}

      <div className="training-body">
        <div className="chart-area chart-stack">
          {visibleTfs.map(tf => (
            <div
              key={tf}
              className={`stacked-chart ${activeTf === tf ? 'active' : ''}`}
              onMouseEnter={() => handleChartMouseEnter(tf)}
            >
              <div className="tf-badge" style={{ background: getTimeframeColor(tf) }}>{tf}</div>
              <Chart
                ref={setChartRef(tf)}
                bars={barsByTf[tf] ?? []}
                timeframe={tf}
                digits={session?.digits}
                cursor={activeTf === tf ? interaction.cursor : undefined}
                onNeedMoreHistory={(earliest) => loadMoreHistory(tf, earliest)}
                onChartClick={activeTf === tf ? interaction.handlers.onChartClick : undefined}
                onMouseMove={activeTf === tf ? interaction.handlers.onMouseMove : undefined}
                onMouseDown={activeTf === tf ? interaction.handlers.onMouseDown : undefined}
                onMouseUp={activeTf === tf ? interaction.handlers.onMouseUp : undefined}
                priceLines={priceLinesForTf(drawings, tf, interaction.preview)}
                indicators={indicators}
              />
              <DrawingOverlay
                chartHandle={chartHandles.get(tf) ?? null}
                drawings={drawings}
                preview={activeTf === tf ? interaction.preview : null}
                activeTimeframe={tf}
                hoveredId={activeTf === tf ? interaction.hoveredId : null}
              />
            </div>
          ))}
          {visibleTfs.length === 0 && (
            <div className="empty-chart-hint">表示する時間足を選択してください</div>
          )}
        </div>

        <div className="sidebar">
          {phase === 'analyzing' && (
            <div className="pick-candidate-header">
              <span>候補: {currentSymbol}</span>
              <button
                className={`star-btn ${isCurrentStar ? 'on' : ''}`}
                onClick={() => void toggleCandidate()}
              >
                {isCurrentStar ? '★ 解除' : '☆ 追加'}
              </button>
            </div>
          )}

          {phase !== 'reviewing' && (
            <TradePanel
              activeTrade={activeTrade}
              currentPrice={currentPrice}
              onEnter={handleEnter}
              onExit={handleExit}
              loading={loading}
              digits={session?.digits ?? 5}
              styles={tradingStyles}
            />
          )}

          <IndicatorPanel active={indicators} onChange={setIndicators} />
          <DrawingTools
            activeTool={interaction.activeTool}
            activeWave={interaction.activeWave}
            onSelectTool={interaction.selectTool}
            drawings={drawings}
            onRemove={(id) => void removeDrawing(id)}
            digits={session?.digits ?? 5}
          />

          {phase === 'reviewing' && <PostReviewPanel sessionId={sessionId} />}

          <div className="action-buttons">
            <button
              onClick={() => void handleAdvance()}
              disabled={advancing}
              className="advance-btn"
            >
              {advancing ? '...' : '▶ +1本'}
            </button>
            <button
              onClick={() => void handleAdvance(5)}
              disabled={advancing}
              className="advance-btn"
            >
              ▶▶ +5本
            </button>
            {phase === 'analyzing' && (
              <>
                <button onClick={() => setSkipping(true)} className="skip-btn">見送り</button>
                {candidates.length > 0 && (
                  <button onClick={() => setConfirmSkipAll(true)} className="skip-all-btn">
                    全候補見送り
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => void handleCloseSession()}
              className="close-session-btn"
              title="振り返りが終わったらこのボタンでセッションを破棄します(§10.3)"
            >
              セッションを閉じる
            </button>
          </div>
        </div>
      </div>

      {skipping && (
        <SkipEntryModal
          styles={tradingStyles}
          onConfirm={handleSkipConfirm}
          onCancel={() => setSkipping(false)}
        />
      )}

      {confirmSkipAll && (
        <Modal onClose={() => setConfirmSkipAll(false)}>
          <h2>全候補を見送り</h2>
          <p className="modal-hint">見送り理由(任意)</p>
          <textarea
            rows={3}
            value={skipAllReasonDraft}
            onChange={e => setSkipAllReasonDraft(e.target.value)}
            placeholder="優位性のある銘柄が見つからなかった 等"
          />
          <div className="modal-actions">
            <button onClick={() => setConfirmSkipAll(false)}>キャンセル</button>
            <button className="primary" onClick={() => void handleSkipAllConfirm()}>
              見送り確定
            </button>
          </div>
        </Modal>
      )}

      {memoOpen && session && (
        <MemoPanel
          session={session}
          initialSymbol={currentSymbol}
          onClose={() => setMemoOpen(false)}
          onChange={setSession}
        />
      )}
    </div>
  )
}
