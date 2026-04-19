import { useState } from 'react'
import type { ScenarioInput, TradeResponse } from '../api/client'
import { ScenarioForm } from './ScenarioForm'

type Props = {
  activeTrade: TradeResponse | null
  currentPrice: number | null
  onEnter: (
    direction: 'buy' | 'sell',
    price: number,
    sl: number,
    tp: number | undefined,
    scenario: ScenarioInput,
  ) => Promise<void>
  onExit: (price: number, reason: string) => Promise<void>
  loading: boolean
  /** 価格入力 step のための小数桁数。 */
  digits: number
}

export function TradePanel({ activeTrade, currentPrice, onEnter, onExit, loading, digits }: Props) {
  const step = Math.pow(10, -digits).toFixed(digits)
  const [price, setPrice] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [exitPrice, setExitPrice] = useState('')
  const [scenario, setScenario] = useState<ScenarioInput>({
    scenario_main: '',
    entry_basis: '',
    tags: [],
  })

  const scenarioValid =
    (scenario.scenario_main?.trim().length ?? 0) > 0 &&
    (scenario.entry_basis?.trim().length ?? 0) > 0 &&
    (scenario.tags?.length ?? 0) > 0

  async function handleEnter(direction: 'buy' | 'sell') {
    const p = parseFloat(price)
    const slv = parseFloat(sl)
    if (isNaN(p) || isNaN(slv)) return
    if (!scenarioValid) return
    const tpv = parseFloat(tp) || undefined
    await onEnter(direction, p, slv, tpv, scenario)
    setPrice(''); setSl(''); setTp('')
    setScenario({ scenario_main: '', entry_basis: '', tags: [] })
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
    const sc = activeTrade.scenario
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
          {sc && (sc.scenario_main || sc.entry_basis || sc.tags.length > 0) && (
            <div className="scenario-readout">
              {sc.scenario_main && <div className="scenario-block"><span className="scenario-readout-label">メモ</span>{sc.scenario_main}</div>}
              {sc.entry_basis && <div className="scenario-block"><span className="scenario-readout-label">根拠</span>{sc.entry_basis}</div>}
              {sc.tags.length > 0 && (
                <div className="scenario-block">
                  {sc.tags.map(t => <span key={t} className="readout-tag">#{t}</span>)}
                </div>
              )}
            </div>
          )}
          {activeTrade.is_open && (
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
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="trade-panel">
      <div className="entry-form">
        <ScenarioForm value={scenario} onChange={setScenario} disabled={loading} />
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
            disabled={loading || !price || !sl || !scenarioValid}
            title={!scenarioValid ? 'メモ・根拠・タグは必須です' : ''}
          >
            BUY
          </button>
          <button
            className="sell-btn"
            onClick={() => handleEnter('sell')}
            disabled={loading || !price || !sl || !scenarioValid}
            title={!scenarioValid ? 'メモ・根拠・タグは必須です' : ''}
          >
            SELL
          </button>
        </div>
        {!scenarioValid && (
          <p className="scenario-hint">メモ本文・エントリー根拠・タグは全て入力必須です</p>
        )}
      </div>
    </div>
  )
}
