import { useState } from 'react'
import type { ScenarioInput, TradeResponse, TradingStyle } from '../api/client'
import { ScenarioForm, isScenarioValid } from './ScenarioForm'
import { StyleSelect } from './StyleSelect'

type EnterArgs = {
  direction: 'buy' | 'sell'
  price: number
  sl: number
  tp: number | undefined
  scenario: ScenarioInput
  styleId: string
  styleReason: string
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

export function TradePanel({
  activeTrade, currentPrice, onEnter, onExit, loading, digits, styles,
}: Props) {
  const step = Math.pow(10, -digits).toFixed(digits)
  const [price, setPrice] = useState('')
  const [sl, setSl] = useState('')
  const [tp, setTp] = useState('')
  const [exitPrice, setExitPrice] = useState('')
  const [scenario, setScenario] = useState<ScenarioInput>({})
  const [styleId, setStyleId] = useState('')
  const [styleReason, setStyleReason] = useState('')

  const scenarioValid = isScenarioValid(scenario)
  const styleValid = styleId !== '' && styleReason.trim().length > 0

  async function handleEnter(direction: 'buy' | 'sell') {
    const p = parseFloat(price)
    const slv = parseFloat(sl)
    if (isNaN(p) || isNaN(slv)) return
    if (!scenarioValid || !styleValid) return
    const tpv = parseFloat(tp) || undefined
    await onEnter({ direction, price: p, sl: slv, tp: tpv, scenario, styleId, styleReason })
    setPrice(''); setSl(''); setTp('')
    setScenario({})
    setStyleId(''); setStyleReason('')
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
          {(style || activeTrade.style_selection_reason) && (
            <div className="scenario-readout">
              {style && <div className="scenario-block"><span className="scenario-readout-label">スタイル</span>{style.name}</div>}
              {activeTrade.style_selection_reason && (
                <div className="scenario-block"><span className="scenario-readout-label">選定理由</span>{activeTrade.style_selection_reason}</div>
              )}
            </div>
          )}
          {sc && (
            <div className="scenario-readout">
              {sc.environment && <div className="scenario-block"><span className="scenario-readout-label">環境</span>{sc.environment}</div>}
              {sc.market_view && <div className="scenario-block"><span className="scenario-readout-label">相場観</span>{sc.market_view}</div>}
              {sc.event_recognition && <div className="scenario-block"><span className="scenario-readout-label">指標</span>{sc.event_recognition}</div>}
              {sc.symbol_reason && <div className="scenario-block"><span className="scenario-readout-label">銘柄理由</span>{sc.symbol_reason}</div>}
              {sc.skipped_candidates && <div className="scenario-block"><span className="scenario-readout-label">見送り候補</span>{sc.skipped_candidates}</div>}
              {sc.scenario_main && <div className="scenario-block"><span className="scenario-readout-label">メイン</span>{sc.scenario_main}</div>}
              {sc.scenario_alt1 && <div className="scenario-block"><span className="scenario-readout-label">代替1</span>{sc.scenario_alt1}</div>}
              {sc.scenario_alt2 && <div className="scenario-block"><span className="scenario-readout-label">代替2</span>{sc.scenario_alt2}</div>}
              {sc.wave_count && <div className="scenario-block"><span className="scenario-readout-label">波動</span>{sc.wave_count}</div>}
              {sc.entry_basis && <div className="scenario-block"><span className="scenario-readout-label">根拠</span>{sc.entry_basis}</div>}
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

  const ready = price && sl && scenarioValid && styleValid

  return (
    <div className="trade-panel">
      <div className="entry-form">
        <ScenarioForm value={scenario} onChange={setScenario} disabled={loading} />
        <StyleSelect
          styles={styles}
          styleId={styleId}
          onStyleIdChange={setStyleId}
          reason={styleReason}
          onReasonChange={setStyleReason}
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
            title={!ready ? 'メモ・根拠・スタイル・理由は必須です' : ''}
          >
            BUY
          </button>
          <button
            className="sell-btn"
            onClick={() => handleEnter('sell')}
            disabled={loading || !ready}
            title={!ready ? 'メモ・根拠・スタイル・理由は必須です' : ''}
          >
            SELL
          </button>
        </div>
        {!ready && (
          <p className="scenario-hint">メモ・根拠・スタイル・選定理由は全て入力必須です</p>
        )}
      </div>
    </div>
  )
}
