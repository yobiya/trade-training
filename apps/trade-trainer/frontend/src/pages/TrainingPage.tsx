import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api/client'
import type { OhlcBar, ScenarioInput, TradeResponse, TradeSession } from '../api/client'
import { Chart } from '../components/Chart'
import { TradePanel } from '../components/TradePanel'

const TIMEFRAMES = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1']

// 時間足ごとに取得するバー本数(仕様書 §5.1 マルチタイムフレーム)。
const BARS_BY_TF: Record<string, number> = {
  M5: 500, M15: 400, M30: 400, H1: 400, H4: 300, D1: 200,
}

// メイン時間足を選んだときに並行表示する上位足(仕様書 §5.1)。
// D1 は最上位のため上位足なしで main のみ表示。
const UPPER_TFS: Record<string, string[]> = {
  M5: ['M15', 'H1', 'H4'],
  M15: ['H1', 'H4', 'D1'],
  M30: ['H1', 'H4', 'D1'],
  H1: ['H4', 'D1'],
  H4: ['D1'],
  D1: [],
}

type Props = {
  sessionId: string
  onBack: () => void
}

export function TrainingPage({ sessionId, onBack }: Props) {
  const [session, setSession] = useState<TradeSession | null>(null)
  const [barsByTf, setBarsByTf] = useState<Record<string, OhlcBar[]>>({})
  const [timeframe, setTimeframe] = useState('M5')
  const [activeTrade, setActiveTrade] = useState<TradeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [advancing, setAdvancing] = useState(false)

  const loadingByTfRef = useRef<Record<string, boolean>>({})
  const noMoreByTfRef = useRef<Record<string, boolean>>({})

  const upperTfs = UPPER_TFS[timeframe] ?? []
  const mainBars = barsByTf[timeframe] ?? []
  const currentPrice = mainBars.length > 0 ? mainBars[mainBars.length - 1].c : null

  function notify(msg: string) {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3000)
  }

  const fetchAllTfs = useCallback(async (main: string): Promise<Record<string, OhlcBar[]>> => {
    const tfs = [main, ...(UPPER_TFS[main] ?? [])]
    const results = await Promise.all(
      tfs.map(tf => api.chart.get(sessionId, tf, BARS_BY_TF[tf] ?? 200)),
    )
    const next: Record<string, OhlcBar[]> = {}
    tfs.forEach((tf, i) => {
      next[tf] = results[i].bars
      noMoreByTfRef.current[tf] = false
    })
    return next
  }, [sessionId])

  const loadCharts = useCallback(async (main: string) => {
    const next = await fetchAllTfs(main)
    setBarsByTf(next)
    const trade = await api.trades.getActive(sessionId)
    setActiveTrade(trade)
  }, [sessionId, fetchAllTfs])

  useEffect(() => {
    void api.sessions.get(sessionId).then(setSession)
    void loadCharts(timeframe)
  }, [sessionId, loadCharts, timeframe])

  async function handleAdvance(n: number = 1) {
    setAdvancing(true)
    try {
      const res = await api.chart.advance(sessionId, n)
      const next = await fetchAllTfs(timeframe)
      setBarsByTf(next)
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

  const handleNeedMoreHistory = useCallback(async (tf: string, earliest: number) => {
    if (loadingByTfRef.current[tf] || noMoreByTfRef.current[tf]) return
    loadingByTfRef.current[tf] = true
    try {
      const barsCount = BARS_BY_TF[tf] ?? 200
      const chartData = await api.chart.get(sessionId, tf, barsCount, earliest)
      const newBars = chartData.bars.filter(b => b.t < earliest)
      if (newBars.length === 0) {
        noMoreByTfRef.current[tf] = true
        return
      }
      setBarsByTf(prev => {
        const existing = prev[tf] ?? []
        const seen = new Set(existing.map(b => b.t))
        const fresh = newBars.filter(b => !seen.has(b.t))
        return { ...prev, [tf]: [...fresh, ...existing] }
      })
    } finally {
      loadingByTfRef.current[tf] = false
    }
  }, [sessionId])

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
              ? new Date(session.current_position).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
              : ''}
          </span>
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
                    onNeedMoreHistory={(earliest) => handleNeedMoreHistory(tf, earliest)}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="main-chart">
            <div className="tf-badge main">{timeframe}</div>
            <Chart
              bars={mainBars}
              timeframe={timeframe}
              onNeedMoreHistory={(earliest) => handleNeedMoreHistory(timeframe, earliest)}
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
