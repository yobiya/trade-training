import { useState } from 'react'
import type { TradeResponse } from '../api/client'

type Props = {
  activeTrade: TradeResponse | null
  currentPrice: number | null
  onEnter: (direction: 'buy' | 'sell', price: number, sl?: number, tp?: number) => Promise<void>
  onExit: (price: number, reason: string) => Promise<void>
  loading: boolean
}

export function TradePanel({ activeTrade, currentPrice, onEnter, onExit, loading }: Props) {
  const [price, setPrice] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [exitPrice, setExitPrice] = useState('')

  async function handleEnter(direction: 'buy' | 'sell') {
    const p = parseFloat(price)
    if (isNaN(p)) return
    const slv = parseFloat(sl) || undefined
    const tpv = parseFloat(tp) || undefined
    await onEnter(direction, p, slv, tpv)
    setPrice('')
    setSl('')
    setTp('')
  }

  async function handleExit() {
    const p = parseFloat(exitPrice) || currentPrice
    if (p == null) return
    await onExit(p, 'manual')
    setExitPrice('')
  }

  if (activeTrade) {
    const pnlClass = activeTrade.pips_pnl == null
      ? ''
      : activeTrade.pips_pnl >= 0 ? 'profit' : 'loss'
    return (
      <div className="trade-panel">
        <div className="active-trade">
          <div className="trade-info">
            <span className={`direction ${activeTrade.direction}`}>
              {activeTrade.direction.toUpperCase()}
            </span>
            <span>@ {activeTrade.entry_price}</span>
            {activeTrade.sl && <span>SL: {activeTrade.sl}</span>}
            {activeTrade.tp && <span>TP: {activeTrade.tp}</span>}
          </div>
          {activeTrade.pips_pnl != null && (
            <div className={`pnl ${pnlClass}`}>{activeTrade.pips_pnl > 0 ? '+' : ''}{activeTrade.pips_pnl} pips</div>
          )}
          {activeTrade.is_open && (
            <div className="exit-row">
              <input
                type="number"
                placeholder={`決済価格 (${currentPrice ?? ''})`}
                value={exitPrice}
                onChange={e => setExitPrice(e.target.value)}
                step="0.001"
              />
              <button onClick={handleExit} disabled={loading} className="exit-btn">
                決済
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="trade-panel">
      <div className="entry-form">
        <div className="price-row">
          <input
            type="number"
            placeholder="エントリー価格"
            value={price}
            onChange={e => setPrice(e.target.value)}
            step="0.001"
          />
        </div>
        <div className="sl-tp-row">
          <input
            type="number"
            placeholder="SL"
            value={sl}
            onChange={e => setSl(e.target.value)}
            step="0.001"
          />
          <input
            type="number"
            placeholder="TP"
            value={tp}
            onChange={e => setTp(e.target.value)}
            step="0.001"
          />
        </div>
        <div className="direction-row">
          <button
            className="buy-btn"
            onClick={() => handleEnter('buy')}
            disabled={loading || !price}
          >
            BUY
          </button>
          <button
            className="sell-btn"
            onClick={() => handleEnter('sell')}
            disabled={loading || !price}
          >
            SELL
          </button>
        </div>
      </div>
    </div>
  )
}
