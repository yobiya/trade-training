import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Drawing, EconomicEvent, SettingsResponse } from '../api/client'
import { Chart } from '../components/Chart'
import type { PriceLine } from '../components/Chart'
import { DrawingOverlay } from '../components/DrawingOverlay'
import { DrawingTools } from '../components/DrawingTools'
import { EventOverlay } from '../components/EventOverlay'
import { IndicatorPanel } from '../components/IndicatorPanel'
import { MemoPanel } from '../components/MemoPanel'
import { Modal } from '../components/Modal'
import { PostReviewPanel } from '../components/PostReviewPanel'
import { AiAnalysisPanel } from '../components/AiAnalysisPanel'
import { SkipEntryModal } from '../components/SkipEntryModal'
import { TimeframeSelector } from '../components/TimeframeSelector'
import { TradePanel } from '../components/TradePanel'
import type { IndicatorConfig } from '../indicators/types'
import { SYMBOLS, TIMEFRAMES, getTimeframeColor } from '../constants'
import type { ChartApi, CreateDrawingBody, UpdateDrawingPatch } from '../drawing/types'
import { isDrawingVisibleOnTf } from '../drawing/visibility'
import { useChartRefCache } from '../hooks/useChartRefCache'
import { useCrosshairSync } from '../hooks/useCrosshairSync'
import { useCharts } from '../hooks/useCharts'
import { useDrawings } from '../hooks/useDrawings'
import { useDrawingInteraction } from '../hooks/useDrawingInteraction'
import { useEconomicEvents } from '../hooks/useEconomicEvents'
import { useNotify } from '../hooks/useNotify'
import { useSessionFetch } from '../hooks/useSessionFetch'
import { useTradeFlow } from '../hooks/useTradeFlow'
import { formatJST } from '../utils/datetime'

type Props = {
  sessionId: string
  onBack: () => void
}

function priceLinesForTf(
  drawings: Drawing[],
  tf: string,
  preview: Drawing | null,
  entryDraft: { sl: number | null; tp: number | null },
): PriceLine[] {
  const lines: PriceLine[] = drawings
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
  // §7.4: 組み立て中の SL / TP を全 TF に表示
  if (entryDraft.sl != null) {
    lines.push({ id: -1001, price: entryDraft.sl, label: 'SL', color: '#ff5555' })
  }
  if (entryDraft.tp != null) {
    lines.push({ id: -1002, price: entryDraft.tp, label: 'TP', color: '#58a6ff' })
  }
  return lines
}

/**
 * 仕様書 §6.1 統合フロー: 1 画面で分析 → エントリー → 保有 → 振り返り を通す。
 *
 * 内部状態は以下の hook に分解されている:
 * - `useSessionFetch`: session / activeTrade / latestTrade / phase
 * - `useTradeFlow`: エントリー draft / advance / 決済 / 見送り
 * - `useNotify`: toast 通知(設計 §B I-11.4)
 *
 * SessionPage 自身は orchestration + UI 配置に直結する local state のみ保持する。
 */
export function SessionPage({ sessionId, onBack }: Props) {
  const { notify } = useNotify()
  const {
    session, setSession,
    activeTrade, setActiveTrade,
    latestTrade, setLatestTrade,
    refresh: refreshSession,
    phase,
  } = useSessionFetch(sessionId)

  // UI 配置に直結する local state
  const [analyzingSymbol, setAnalyzingSymbol] = useState<string>(SYMBOLS[0])
  // 仕様書 §6.1 / §6.2: 銘柄セレクタの絞り込みモード
  const [symbolMode, setSymbolMode] = useState<'all' | 'star'>('all')
  const [entryTf, setEntryTf] = useState('M5')
  const [activeTf, setActiveTf] = useState('M5')
  const [hiddenTfs, setHiddenTfs] = useState<Set<string>>(new Set())
  const [indicators, setIndicators] = useState<IndicatorConfig[]>([])
  const [skipping, setSkipping] = useState(false)
  const [memoOpen, setMemoOpen] = useState(false)
  const [confirmSkipAll, setConfirmSkipAll] = useState(false)
  const [skipAllReasonDraft, setSkipAllReasonDraft] = useState('')

  // 現在の対象銘柄(phase + analyzingSymbol + 各 trade.symbol から導出)
  const currentSymbol = phase === 'analyzing'
    ? analyzingSymbol
    : (activeTrade?.symbol ?? latestTrade?.symbol ?? analyzingSymbol)

  const candidates = session?.candidates ?? []
  const isCurrentStar = candidates.some(c => c.symbol === currentSymbol)

  // 仕様書 §6.2: ★ モードの時は候補銘柄のみに絞る
  const displaySymbols = useMemo(() => {
    if (symbolMode === 'star' && candidates.length > 0) {
      const set = new Set(candidates.map(c => c.symbol))
      return SYMBOLS.filter(s => set.has(s))
    }
    return SYMBOLS
  }, [symbolMode, candidates])

  // ★ 0 件で star モードに留まらないよう自動フォールバック
  useEffect(() => {
    if (symbolMode === 'star' && candidates.length === 0) {
      setSymbolMode('all')
    }
  }, [symbolMode, candidates.length])

  // 表示順序: エントリー足を最上段
  const visibleTfs = useMemo(() => {
    const rest = TIMEFRAMES.filter(tf => tf !== entryTf && !hiddenTfs.has(tf))
    const head = hiddenTfs.has(entryTf) ? [] : [entryTf]
    return [...head, ...rest]
  }, [entryTf, hiddenTfs])

  const { barsByTf, loadingByTf, currentPrice, reloadStack, loadMoreHistory } = useCharts(
    sessionId, currentSymbol, visibleTfs, entryTf,
  )
  const { drawings, add: addDrawing, update: updateDrawing, remove: removeDrawing } =
    useDrawings(sessionId, currentSymbol)

  const { handles: chartHandles, setRef: setChartRef } = useChartRefCache()

  // §5.1.2 マルチ TF クロスヘア同期
  useCrosshairSync(chartHandles)
  const chartApiRef = useRef<ChartApi | null>(null)

  // トレード操作系を hook に集約(2026-04-29 で SessionPage から分離)
  const trade = useTradeFlow({
    sessionId, currentSymbol, entryTf,
    reloadStack,
    setSession, setActiveTrade, setLatestTrade,
  })

  // §5.4 経済指標: 設定読み込み + 表示期間内のイベント取得
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  useEffect(() => {
    // I-11.6: 設定取得失敗はデフォルト fallback、ログのみ
    api.settings.get().then(setSettings).catch(err => {
      console.warn('[SessionPage] settings.get failed, falling back to null defaults', err)
      setSettings(null)
    })
  }, [])

  const eventsRange = useMemo(() => {
    let minT: number | null = null
    let maxT: number | null = null
    for (const tf of visibleTfs) {
      const bars = barsByTf[tf]
      if (!bars || bars.length === 0) continue
      const first = bars[0].t
      const last = bars[bars.length - 1].t
      if (minT === null || first < minT) minT = first
      if (maxT === null || last > maxT) maxT = last
    }
    return { from: minT, to: maxT }
  }, [visibleTfs, barsByTf])

  const { events } = useEconomicEvents({
    sessionId,
    symbol: currentSymbol,
    fromUnix: eventsRange.from,
    toUnix: eventsRange.to,
    importanceMin: settings?.event_importance_threshold ?? 3,
    enabled: settings !== null,
  })

  const [hoveredEvent, setHoveredEvent] = useState<EconomicEvent | null>(null)

  function handleChartMouseEnter(tf: string) {
    setActiveTf(tf)
    chartApiRef.current = chartHandles.get(tf)?.api ?? null
  }

  /** px で 12 以内に最も近いイベントを返す。 */
  const findNearestEvent = useCallback((pxX: number): EconomicEvent | null => {
    if (events.length === 0) return null
    const apiCoord = chartApiRef.current
    if (!apiCoord) return null
    let best: { ev: EconomicEvent; dx: number } | null = null
    for (const ev of events) {
      const t = Math.floor(new Date(ev.event_time).getTime() / 1000)
      const x = apiCoord.timeToX(t)
      if (x === null) continue
      const dx = Math.abs(x - pxX)
      if (dx > 12) continue
      if (best === null || dx < best.dx) best = { ev, dx }
    }
    return best?.ev ?? null
  }, [events])

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

  // §7.4: SL/TP 配置のチャートクリック横取り
  const pipSize = currentSymbol.toUpperCase().endsWith('JPY') ? 0.01 : 0.0001
  const roundToDigits = useCallback((p: number): number => {
    const d = session?.digits ?? 5
    const factor = Math.pow(10, d)
    return Math.round(p * factor) / factor
  }, [session?.digits])

  const handleChartClick = useCallback(
    (price: number, time: number | null, px: { x: number; y: number }) => {
      if (trade.entryPlacing) {
        const rounded = roundToDigits(price)
        trade.setEntryDraft(prev => ({ ...prev, [trade.entryPlacing!]: rounded }))
        trade.setEntryPlacing(null)
        return
      }
      interaction.handlers.onChartClick(price, time, px)
    },
    [trade, interaction.handlers, roundToDigits],
  )

  // 配置モードに入ったら描画ツールを Idle に戻す(衝突回避)
  useEffect(() => {
    if (trade.entryPlacing && interaction.activeTool) {
      interaction.selectTool(null)
    }
  }, [trade.entryPlacing, interaction])

  // 銘柄切替 / フェーズ移行で draft をクリア
  useEffect(() => {
    if (phase !== 'analyzing') {
      trade.setEntryDraft({ sl: null, tp: null })
      trade.setEntryPlacing(null)
    }
  }, [phase, currentSymbol, trade])

  async function handleSkipConfirm(reason: string) {
    await trade.handleSkip(reason)
    setSkipping(false)
  }

  async function handleSkipAllConfirm() {
    await trade.handleSkip(skipAllReasonDraft || undefined)
    setConfirmSkipAll(false)
    setSkipAllReasonDraft('')
  }

  const toggleCandidate = useCallback(async () => {
    if (!session) return
    const existing = session.candidates.find(c => c.symbol === currentSymbol)
    try {
      if (existing) {
        await api.sessions.deleteCandidate(sessionId, existing.id)
      } else {
        await api.sessions.addCandidate(sessionId, currentSymbol)
      }
      await refreshSession()
    } catch (err) {
      console.warn('[SessionPage] toggleCandidate failed', err)
      notify('候補の更新に失敗しました', 'error')
    }
  }, [session, currentSymbol, sessionId, refreshSession, notify])

  // 仕様書 §6.2: 現在モードのリスト内で前後の銘柄に循環移動
  const stepSymbol = useCallback((dir: 1 | -1) => {
    if (displaySymbols.length === 0) return
    const i = displaySymbols.indexOf(currentSymbol)
    if (i < 0) {
      setAnalyzingSymbol(displaySymbols[0])
      return
    }
    const next = (i + dir + displaySymbols.length) % displaySymbols.length
    setAnalyzingSymbol(displaySymbols[next])
  }, [displaySymbols, currentSymbol])

  // 仕様書 §7.3 (M) / §6.2 ([, ], F, S) キーボードショートカット
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      // M はフェーズ問わず有効
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        setMemoOpen(v => !v)
        return
      }
      // 銘柄操作系は分析中のみ
      if (phase !== 'analyzing') return
      if (e.key === '[') { e.preventDefault(); stepSymbol(-1) }
      else if (e.key === ']') { e.preventDefault(); stepSymbol(1) }
      else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setSymbolMode(m => m === 'all' ? 'star' : 'all')
      }
      else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        void toggleCandidate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, stepSymbol, toggleCandidate])

  return (
    <div className="training-page session-page">
      <header className="training-header">
        <button onClick={onBack} className="back-btn">← 一覧</button>
        <input
          className="session-name-input"
          type="text"
          placeholder="セッション名(任意)"
          defaultValue={session?.name ?? ''}
          maxLength={100}
          onBlur={async (e) => {
            const v = e.currentTarget.value
            if ((session?.name ?? '') === v) return
            try {
              const s = await api.sessions.updateName(sessionId, v || null)
              setSession(s)
            } catch {
              e.currentTarget.value = session?.name ?? ''
              notify('セッション名の更新に失敗しました', 'error')
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          }}
        />
        <div className="session-info">
          {phase === 'analyzing' ? (
            <div className="symbol-selector">
              <div className="symbol-mode-pills" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={symbolMode === 'all'}
                  className={`pill ${symbolMode === 'all' ? 'active' : ''}`}
                  onClick={() => setSymbolMode('all')}
                  title="全銘柄を表示 (F)"
                >
                  ALL ({SYMBOLS.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={symbolMode === 'star'}
                  className={`pill ${symbolMode === 'star' ? 'active' : ''}`}
                  onClick={() => setSymbolMode('star')}
                  disabled={candidates.length === 0}
                  title="★ を付けた銘柄のみ表示 (F)"
                >
                  ★ ({candidates.length})
                </button>
              </div>
              <button
                type="button"
                className="symbol-step-btn"
                onClick={() => stepSymbol(-1)}
                title="前の銘柄 ([)"
              >‹</button>
              <select
                className="symbol-dropdown"
                value={currentSymbol}
                onChange={e => setAnalyzingSymbol(e.target.value)}
              >
                {displaySymbols.map(sym => {
                  const star = candidates.some(c => c.symbol === sym) ? '★ ' : ''
                  return <option key={sym} value={sym}>{star}{sym}</option>
                })}
              </select>
              <button
                type="button"
                className="symbol-step-btn"
                onClick={() => stepSymbol(1)}
                title="次の銘柄 (])"
              >›</button>
              <button
                type="button"
                className={`star-btn ${isCurrentStar ? 'on' : ''}`}
                onClick={() => void toggleCandidate()}
                title="現在銘柄の ★ をトグル (S)"
              >
                {isCurrentStar ? '★' : '☆'}
              </button>
            </div>
          ) : (
            <span className="symbol">{currentSymbol}</span>
          )}
          <span className="phase-badge">
            {phase === 'analyzing' ? '分析中' : phase === 'holding' ? '保有中' : '振り返り'}
          </span>
          {session?.is_settled && (
            <span className="status-badge settled" title="振り返りメモが書かれて決着済み(§4.2.1)">
              決着済み
            </span>
          )}
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

      <div className="training-body">
        <div className="chart-area chart-stack">
          {visibleTfs.map(tf => (
            <div
              key={tf}
              className={`stacked-chart ${activeTf === tf ? 'active' : ''}`}
              onMouseEnter={() => handleChartMouseEnter(tf)}
            >
              <div className="tf-badge" style={{ background: getTimeframeColor(tf) }}>{tf}</div>
              {loadingByTf[tf] && (
                <div className="chart-loading-overlay" role="status" aria-live="polite">
                  <div className="chart-loading-spinner" />
                  <span>読み込み中… (キャッシュ未生成の TF は数秒かかることがあります)</span>
                </div>
              )}
              <Chart
                key={`${tf}-${currentSymbol}`}
                ref={setChartRef(tf)}
                bars={barsByTf[tf] ?? []}
                timeframe={tf}
                digits={session?.digits}
                cursor={activeTf === tf ? (trade.entryPlacing ? 'crosshair' : interaction.cursor) : undefined}
                onNeedMoreHistory={(earliest) => void loadMoreHistory(tf, earliest)}
                onChartClick={activeTf === tf ? handleChartClick : undefined}
                onMouseMove={activeTf === tf ? (price, time, px) => {
                  interaction.handlers.onMouseMove(price, time, px)
                  setHoveredEvent(findNearestEvent(px.x))
                } : undefined}
                onMouseDown={activeTf === tf ? interaction.handlers.onMouseDown : undefined}
                onMouseUp={activeTf === tf ? interaction.handlers.onMouseUp : undefined}
                priceLines={priceLinesForTf(drawings, tf, interaction.preview, trade.entryDraft)}
                indicators={indicators}
              />
              <EventOverlay
                chartHandle={chartHandles.get(tf) ?? null}
                events={events}
                shadingBeforeMin={settings?.event_shading_before_min ?? 5}
                shadingAfterMin={settings?.event_shading_after_min ?? 30}
                hoveredEvent={activeTf === tf ? hoveredEvent : null}
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
          {phase !== 'reviewing' && (
            <TradePanel
              activeTrade={activeTrade}
              currentPrice={currentPrice}
              onEnter={trade.handleEnter}
              onExit={trade.handleExit}
              loading={trade.loading}
              digits={session?.digits ?? 5}
              entryDraft={trade.entryDraft}
              entryPlacing={trade.entryPlacing}
              pipSize={pipSize}
              onPlaceSL={() => trade.setEntryPlacing(trade.entryPlacing === 'sl' ? null : 'sl')}
              onPlaceTP={() => trade.setEntryPlacing(trade.entryPlacing === 'tp' ? null : 'tp')}
              onClearSL={() => trade.setEntryDraft(d => ({ ...d, sl: null }))}
              onClearTP={() => trade.setEntryDraft(d => ({ ...d, tp: null }))}
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

          {phase === 'reviewing' && session && (
            <PostReviewPanel session={session} onSessionChange={setSession} />
          )}
          {phase === 'reviewing' && (
            <AiAnalysisPanel sessionId={sessionId} mode="review" chartHandles={chartHandles} />
          )}

          <div className="action-buttons">
            <button
              onClick={() => void trade.handleAdvance()}
              disabled={trade.advancing}
              className="advance-btn"
            >
              {trade.advancing ? '...' : '▶ +1本'}
            </button>
            <button
              onClick={() => void trade.handleAdvance(5)}
              disabled={trade.advancing}
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
          </div>
        </div>
      </div>

      {skipping && (
        <SkipEntryModal
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
