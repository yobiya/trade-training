import { useState } from 'react'
import type { TradeResponse, TradingStyle } from '../api/client'
import { StyleSelect } from './StyleSelect'

type EnterArgs = {
  direction: 'buy' | 'sell'
  price: number
  sl: number
  tp: number | undefined
  styleId: string
}

type Props = {
  activeTrade: TradeResponse | null
  currentPrice: number | null
  onEnter: (args: EnterArgs) => Promise<void>
  onExit: (price: number, reason: string) => Promise<void>
  loading: boolean
  digits: number
  styles: TradingStyle[]
}

/**
 * 仕様書 §7.4: エントリー時の必須は 方向・価格・SL・TP・スタイル id のみ。
 * 根拠・シナリオ・選定理由等はメモパネル(§7.3)で書く。
 */
export function TradePanel({
  activeTrade, currentPrice, onEnter, onExit, loading, digits, styles,
}: Props) {
  const step = Math.pow(10, -digits).toFixed(digits)
  const [price, setPrice] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [exitPrice, setExitPrice] = useState('')
  const [styleId, setStyleId] = useState('')

  async function handleEnter(direction: 'buy' | 'sell') {
    const p = parseFloat(price)
    const slv = parseFloat(sl)
    if (isNaN(p) || isNaN(slv) || !styleId) return
    const tpv = parseFloat(tp) || undefined
    await onEnter({ direction, price: p, sl: slv, tp: tpv, styleId })
    setPrice(''); setSl(''); setTp(''); setStyleId('')
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
    const style = styles.find(s => s.id === activeTrade.style_id)
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
          {style && (
            <div className="scenario-readout">
              <div className="scenario-block"><span className="scenario-readout-label">スタイル</span>{style.name}</div>
            </div>
          )}
          {activeTrade.is_open && (
            <div className="exit-form">
              <div className="exit-row">
                <input
                  type="number"
                  placeholder={`決済価格 (${currentPrice ?? ''})`}
                  value={exitPrice}
                  onChange={e => setExitPrice(e.target.value)}
                  step={step}
                />
                <button onClick={handleExit} disabled={loading} className="exit-btn">
                  決済
                </button>
              </div>
              <p className="memo-inline-hint">決済所感は M キー/メモボタンで横断メモに追記</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  const ready = !!(price && sl && styleId)

  return (
    <div className="trade-panel">
      <div className="entry-form">
        <StyleSelect
          styles={styles}
          styleId={styleId}
          onStyleIdChange={setStyleId}
          disabled={loading}
        />
        <div className="price-row">
          <input
            type="number"
            placeholder="エントリー価格"
            value={price}
            onChange={e => setPrice(e.target.value)}
            step={step}
          />
        </div>
        <div className="sl-tp-row">
          <input
            type="number"
            placeholder="SL (必須)"
            value={sl}
            onChange={e => setSl(e.target.value)}
            step={step}
          />
          <input
            type="number"
            placeholder="TP"
            value={tp}
            onChange={e => setTp(e.target.value)}
            step={step}
          />
        </div>
        <div className="direction-row">
          <button
            className="buy-btn"
            onClick={() => handleEnter('buy')}
            disabled={loading || !ready}
            title={!ready ? '価格・SL・スタイルは必須' : ''}
          >
            BUY
          </button>
          <button
            className="sell-btn"
            onClick={() => handleEnter('sell')}
            disabled={loading || !ready}
            title={!ready ? '価格・SL・スタイルは必須' : ''}
          >
            SELL
          </button>
        </div>
        <p className="memo-inline-hint">根拠・シナリオは M キー/メモボタンでメモパネルに書く(§7.3)</p>
      </div>
    </div>
  )
}
