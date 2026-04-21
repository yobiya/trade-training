import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Drawing, TradeResponse, TradeSession } from '../api/client'
import { Chart } from '../components/Chart'
import type { ChartHandle, PriceLine } from '../components/Chart'
import { DrawingOverlay } from '../components/DrawingOverlay'
import { DrawingTools } from '../components/DrawingTools'
import { IndicatorPanel } from '../components/IndicatorPanel'
import { TradePanel } from '../components/TradePanel'
import type { IndicatorConfig } from '../indicators/types'
import { TIMEFRAMES, getTimeframeColor } from '../constants'
import type { ChartApi, CreateDrawingBody, UpdateDrawingPatch } from '../drawing/types'
import { useCharts } from '../hooks/useCharts'
import { useDrawings } from '../hooks/useDrawings'
import { useDrawingInteraction } from '../hooks/useDrawingInteraction'
import { useTradingStyles } from '../hooks/useTradingStyles'
import { formatJST } from '../utils/datetime'

type Props = {
  sessionId: string
  onBack: () => void
}

// 仕様書 §5.3 デフォルト表示範囲
function isDrawingVisibleOnTf(d: Drawing, tf: string): boolean {
  if (d.visible_on_timeframes) return d.visible_on_timeframes.includes(tf)
  if (d.kind === 'line' || d.kind === 'trendline') return true
  return d.timeframe === tf
}

function priceLinesForTf(drawings: Drawing[], tf: string, preview: Drawing | null): PriceLine[] {
  const base = drawings
    .filter(d => d.kind === 'line' && isDrawingVisibleOnTf(d, tf))
    .map(d => {
      const previewMatch = preview?.id === d.id ? preview : null
      return {
        id: d.id,
        price: Number(previewMatch?.data.price ?? d.data.price),
        label: d.label ?? undefined,
        color: getTimeframeColor(d.timeframe),  // §5.3: 作成時 TF の色で識別
      }
    })
  // プレビュー中の新規作成(未保存)にも対応できるよう、未保存 preview の水平線も足す余地あり
  return base
}

export function TrainingPage({ sessionId, onBack }: Props) {
  const [session, setSession] = useState<TradeSession | null>(null)
  // 仕様書 §5.1: エントリー足(最上段)とアクティブ TF(描画作成時の作成 TF)。
  // アクティブ TF はマウスが乗ったチャートで切り替わる。
  const [entryTf, setEntryTf] = useState('M5')
  const [activeTf, setActiveTf] = useState('M5')
  const [hiddenTfs, setHiddenTfs] = useState<Set<string>>(new Set())
  const [activeTrade, setActiveTrade] = useState<TradeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const [indicators, setIndicators] = useState<IndicatorConfig[]>([])

  // 表示順序: エントリー足を最上段に、残りは TIMEFRAMES 順(小 → 大)。
  const visibleTfs = useMemo(() => {
    const rest = TIMEFRAMES.filter(tf => tf !== entryTf && !hiddenTfs.has(tf))
    const head = hiddenTfs.has(entryTf) ? [] : [entryTf]
    return [...head, ...rest]
  }, [entryTf, hiddenTfs])

  const { barsByTf, currentPrice, reloadAll, loadMoreHistory } = useCharts(sessionId, visibleTfs, entryTf)
  const { drawings, add: addDrawing, update: updateDrawing, remove: removeDrawing } = useDrawings(sessionId)
  const tradingStyles = useTradingStyles()

  const chartHandlesRef = useRef<Map<string, ChartHandle>>(new Map())
  const [chartHandles, setChartHandles] = useState<Map<string, ChartHandle>>(new Map())
  const chartApiRef = useRef<ChartApi | null>(null)

  const setChartRef = useCallback((tf: string) => (handle: ChartHandle | null) => {
    const map = chartHandlesRef.current
    if (handle) map.set(tf, handle)
    else map.delete(tf)
    setChartHandles(new Map(map))
  }, [])

  function handleChartMouseEnter(tf: string) {
    setActiveTf(tf)
    const handle = chartHandlesRef.current.get(tf)
    chartApiRef.current = handle?.api ?? null
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
  }, [sessionId])

  async function handleAdvance(n: number = 1) {
    setAdvancing(true)
    try {
      const res = await api.chart.advance(sessionId, n)
      await reloadAll()
      if (res.trade_auto_closed) {
        const pips = res.trade_pips_pnl ?? 0
        notify(`自動決済: ${res.trade_exit_reason?.toUpperCase()} @ ${res.trade_exit_price} (${pips > 0 ? '+' : ''}${pips} pips)`)
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
    scenario: import('../api/client').ScenarioInput
    styleId: string
    styleReason: string
  }) {
    setLoading(true)
    try {
      const trade = await api.trades.enter(sessionId, {
        direction: args.direction,
        price: args.price,
        sl: args.sl,
        tp: args.tp,
        scenario: args.scenario,
        style_id: args.styleId,
        style_selection_reason: args.styleReason,
      })
      setActiveTrade(trade)
      notify(`エントリー: ${args.direction.toUpperCase()} @ ${args.price}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleExit(price: number, reason: string) {
    setLoading(true)
    try {
      const trade = await api.trades.exit(sessionId, { price, reason })
      setActiveTrade(trade)
      const pips = trade.pips_pnl ?? 0
      notify(`決済: ${price} (${pips > 0 ? '+' : ''}${pips} pips)`)
    } finally {
      setLoading(false)
    }
  }

  async function handleSkip() {
    await api.sessions.skip(sessionId)
    notify('見送り')
    onBack()
  }

  return (
    <div className="training-page">
      <header className="training-header">
        <button onClick={onBack} className="back-btn">← 一覧</button>
        <div className="session-info">
          <span className="symbol">{session?.symbol ?? '—'}</span>
          <span className="position">{formatJST(session?.current_position, '')}</span>
        </div>
        <div className="tf-selector">
          <span className="tf-selector-label">エントリー足:</span>
          {TIMEFRAMES.map(tf => (
            <label key={`entry-${tf}`} className={`tf-entry-radio ${entryTf === tf ? 'active' : ''}`}>
              <input
                type="radio"
                name="entry-tf"
                checked={entryTf === tf}
                onChange={() => setEntryTf(tf)}
              />
              {tf}
            </label>
          ))}
          <span className="tf-selector-sep">|</span>
          <span className="tf-selector-label">表示:</span>
          {TIMEFRAMES.map(tf => (
            <label key={`show-${tf}`} className={`tf-show-check ${!hiddenTfs.has(tf) ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={!hiddenTfs.has(tf)}
                onChange={() => toggleTfVisibility(tf)}
              />
              {tf}
            </label>
          ))}
        </div>
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
          <TradePanel
            activeTrade={activeTrade}
            currentPrice={currentPrice}
            onEnter={handleEnter}
            onExit={handleExit}
            loading={loading}
            digits={session?.digits ?? 5}
            styles={tradingStyles}
          />
          <IndicatorPanel active={indicators} onChange={setIndicators} />
          <DrawingTools
            activeTool={interaction.activeTool}
            onSelectTool={interaction.selectTool}
            drawings={drawings}
            onRemove={(id) => void removeDrawing(id)}
            digits={session?.digits ?? 5}
          />
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
            {!activeTrade?.is_open && (
              <button onClick={() => void handleSkip()} className="skip-btn">見送り</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
