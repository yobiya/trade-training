import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { OhlcBar, TradeResponse, TradeSession } from '../api/client'
import { Chart } from '../components/Chart'
import { TradePanel } from '../components/TradePanel'

const TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1']

type Props = {
  sessionId: string
  onBack: () => void
}

export function TrainingPage({ sessionId, onBack }: Props) {
  const [session, setSession] = useState<TradeSession | null>(null)
  const [bars, setBars] = useState<OhlcBar[]>([])
  const [timeframe, setTimeframe] = useState('M5')
  const [activeTrade, setActiveTrade] = useState<TradeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)

  const currentPrice = bars.length > 0 ? bars[bars.length - 1].c : null

  function notify(msg: string) {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  const loadChart = useCallback(async (tf: string) => {
    const [chartData, tradeData] = await Promise.all([
      api.chart.get(sessionId, tf),
      api.trades.getActive(sessionId),
    ])
    setBars(chartData.bars)
    setActiveTrade(tradeData)
  }, [sessionId])

  useEffect(() => {
    void api.sessions.get(sessionId).then(setSession)
    void loadChart(timeframe)
  }, [sessionId, loadChart, timeframe])

  async function handleAdvance() {
    setAdvancing(true)
    try {
      const res = await api.chart.advance(sessionId, 1)
      setBars(prev => {
        const merged = [...prev, ...res.new_bars]
        const seen = new Set<number>()
        return merged.filter(b => {
          if (seen.has(b.t)) return false
          seen.add(b.t)
          return true
        }).slice(-500)
      })
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

  async function handleAdvanceMulti(n: number) {
    setAdvancing(true)
    try {
      for (let i = 0; i < n; i++) {
        await handleAdvance()
      }
    } finally {
      setAdvancing(false)
    }
  }

  async function handleEnter(direction: 'buy' | 'sell', price: number, sl?: number, tp?: number) {
    setLoading(true)
    try {
      const trade = await api.trades.enter(sessionId, { direction, price, sl, tp })
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
          <span className="position">
            {session?.current_position
              ? new Date(session.current_position).toLocaleString('ja-JP')
              : ''}
          </span>
        </div>
        <div className="tf-selector">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              className={`tf-btn ${timeframe === tf ? 'active' : ''}`}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </header>

      {notification && <div className="notification">{notification}</div>}

      <div className="training-body">
        <div className="chart-area">
          <Chart bars={bars} />
        </div>
        <div className="sidebar">
          <TradePanel
            activeTrade={activeTrade}
            currentPrice={currentPrice}
            onEnter={handleEnter}
            onExit={handleExit}
            loading={loading}
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
              onClick={() => void handleAdvanceMulti(5)}
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
