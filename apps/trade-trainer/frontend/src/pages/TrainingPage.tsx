import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { OhlcBar, ScenarioInput, TradeResponse, TradeSession } from '../api/client'
import { Chart } from '../components/Chart'
import { TradePanel } from '../components/TradePanel'

const TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1']

// 時間足ごとに取得するバー本数。上位足ほど 1 バーの時間が長いため本数を増やしすぎず、
// 各時間足でそれなりの期間(数日〜数百日)が表示されるように調整する。
const BARS_BY_TF: Record<string, number> = {
  M5: 500,   // ≒ 41 時間
  M15: 400,  // ≒ 4 日
  M30: 400,  // ≒ 8 日
  H1: 400,   // ≒ 16 日
  H4: 300,   // ≒ 50 日
  D1: 200,   // ≒ 200 日
}

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
  const loadingHistoryRef = useRef(false)
  const noMoreHistoryRef = useRef(false)  // これ以上遡れないと確定した場合に true

  const currentPrice = bars.length > 0 ? bars[bars.length - 1].c : null

  function notify(msg: string) {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  const loadChart = useCallback(async (tf: string) => {
    const barsCount = BARS_BY_TF[tf] ?? 200
    const [chartData, tradeData] = await Promise.all([
      api.chart.get(sessionId, tf, barsCount),
      api.trades.getActive(sessionId),
    ])
    setBars(chartData.bars)
    setActiveTrade(tradeData)
    noMoreHistoryRef.current = false  // 時間足切替や再ロード時は遡及制限を解除
  }, [sessionId])

  useEffect(() => {
    void api.sessions.get(sessionId).then(setSession)
    void loadChart(timeframe)
  }, [sessionId, loadChart, timeframe])

  const handleNeedMoreHistory = useCallback(async (earliest: number) => {
    if (loadingHistoryRef.current || noMoreHistoryRef.current) return
    loadingHistoryRef.current = true
    try {
      const barsCount = BARS_BY_TF[timeframe] ?? 200
      const chartData = await api.chart.get(sessionId, timeframe, barsCount, earliest)
      const newBars = chartData.bars.filter(b => b.t < earliest)
      if (newBars.length === 0) {
        noMoreHistoryRef.current = true
        return
      }
      setBars(prev => {
        const seen = new Set(prev.map(b => b.t))
        const fresh = newBars.filter(b => !seen.has(b.t))
        return [...fresh, ...prev]
      })
    } finally {
      loadingHistoryRef.current = false
    }
  }, [sessionId, timeframe])

  async function handleAdvance(n: number = 1) {
    setAdvancing(true)
    try {
      const res = await api.chart.advance(sessionId, n)
      // 表示中の時間足で再取得する(new_bars は M5 のため、上位足に append できない)
      const barsCount = BARS_BY_TF[timeframe] ?? 200
      const chartData = await api.chart.get(sessionId, timeframe, barsCount)
      setBars(chartData.bars)
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
          <Chart bars={bars} timeframe={timeframe} onNeedMoreHistory={handleNeedMoreHistory} />
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
