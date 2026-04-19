import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Drawing, ScenarioInput, TradeResponse, TradeSession } from '../api/client'
import { Chart } from '../components/Chart'
import type { ChartHandle, PriceLine } from '../components/Chart'
import { DrawingOverlay } from '../components/DrawingOverlay'
import { DrawingTools } from '../components/DrawingTools'
import { IndicatorPanel } from '../components/IndicatorPanel'
import { TradePanel } from '../components/TradePanel'
import type { IndicatorConfig } from '../indicators/types'
import { TIMEFRAMES, UPPER_TFS } from '../constants'
import type { ChartApi, CreateDrawingBody, UpdateDrawingPatch } from '../drawing/types'
import { useCharts } from '../hooks/useCharts'
import { useDrawings } from '../hooks/useDrawings'
import { useDrawingInteraction } from '../hooks/useDrawingInteraction'
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
      }
    })
  // プレビュー中の新規作成(未保存)にも対応できるよう、未保存 preview の水平線も足す余地あり
  return base
}

export function TrainingPage({ sessionId, onBack }: Props) {
  const [session, setSession] = useState<TradeSession | null>(null)
  const [timeframe, setTimeframe] = useState('M5')
  const [activeTrade, setActiveTrade] = useState<TradeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)
  const [indicators, setIndicators] = useState<IndicatorConfig[]>([])

  const { barsByTf, upperTfs, currentPrice, reloadAll, loadMoreHistory } = useCharts(sessionId, timeframe)
  const { drawings, add: addDrawing, update: updateDrawing, remove: removeDrawing } = useDrawings(sessionId)

  const [mainChartHandle, setMainChartHandle] = useState<ChartHandle | null>(null)
  const chartApiRef = useRef<ChartApi | null>(null)
  const setMainChartRef = useCallback((handle: ChartHandle | null) => {
    setMainChartHandle(handle)
    chartApiRef.current = handle?.api ?? null
  }, [])

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
    activeTimeframe: timeframe,
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

  async function handleEnter(
    direction: 'buy' | 'sell',
    price: number,
    sl: number,
    tp: number | undefined,
    scenario: ScenarioInput,
  ) {
    setLoading(true)
    try {
      const trade = await api.trades.enter(sessionId, { direction, price, sl, tp, scenario })
      setActiveTrade(trade)
      notify(`エントリー: ${direction.toUpperCase()} @ ${price}`)
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
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              className={`tf-btn ${timeframe === tf ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
              title={`メイン: ${tf}${UPPER_TFS[tf]?.length ? ' / 上位: ' + UPPER_TFS[tf].join(', ') : ''}`}
            >
              {tf}
            </button>
          ))}
        </div>
      </header>

      {notification && <div className="notification">{notification}</div>}

      <div className="training-body">
        <div className="chart-area">
          {upperTfs.length > 0 && (
            <div className="upper-charts">
              {upperTfs.map(tf => (
                <div key={tf} className="upper-chart">
                  <div className="tf-badge">{tf}</div>
                  <Chart
                    bars={barsByTf[tf] ?? []}
                    timeframe={tf}
                    digits={session?.digits}
                    onNeedMoreHistory={(earliest) => loadMoreHistory(tf, earliest)}
                    priceLines={priceLinesForTf(drawings, tf, interaction.preview)}
                    indicators={indicators}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="main-chart">
            <div className="tf-badge main">{timeframe}</div>
            <Chart
              ref={setMainChartRef}
              bars={barsByTf[timeframe] ?? []}
              timeframe={timeframe}
              digits={session?.digits}
              cursor={interaction.cursor}
              onNeedMoreHistory={(earliest) => loadMoreHistory(timeframe, earliest)}
              onChartClick={interaction.handlers.onChartClick}
              onMouseMove={interaction.handlers.onMouseMove}
              onMouseDown={interaction.handlers.onMouseDown}
              onMouseUp={interaction.handlers.onMouseUp}
              priceLines={priceLinesForTf(drawings, timeframe, interaction.preview)}
              indicators={indicators}
            />
            <DrawingOverlay
              chartHandle={mainChartHandle}
              drawings={drawings}
              preview={interaction.preview}
              activeTimeframe={timeframe}
            />
          </div>
        </div>
        <div className="sidebar">
          <TradePanel
            activeTrade={activeTrade}
            currentPrice={currentPrice}
            onEnter={handleEnter}
            onExit={handleExit}
            loading={loading}
            digits={session?.digits ?? 5}
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
