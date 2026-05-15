import { useState } from 'react'
import type { TradeResponse } from '../api/client'

export type EntryDraft = { sl: number | null; tp: number | null }
export type EntryDirection = 'buy' | 'sell' | null
export type EntryPlacing = 'sl' | 'tp' | null

type EnterArgs = {
  direction: 'buy' | 'sell'
  price: number
  sl: number
  tp: number | undefined
}

type Props = {
  activeTrade: TradeResponse | null
  currentPrice: number | null
  onEnter: (args: EnterArgs) => Promise<void>
  onExit: (price: number, reason: string) => Promise<void>
  loading: boolean
  digits: number
  /** §7.4: SL/TP はチャート上でクリック配置。本コンポーネントは表示と確定操作のみ */
  entryDraft: EntryDraft
  entryPlacing: EntryPlacing
  pipSize: number
  onPlaceSL: () => void
  onPlaceTP: () => void
  onClearSL: () => void
  onClearTP: () => void
}

function formatPrice(p: number, digits: number): string {
  return p.toFixed(digits)
}

function pipsBetween(a: number, b: number, pipSize: number): number {
  return Math.round(Math.abs(a - b) / pipSize * 10) / 10
}

function deriveDirection(currentPrice: number | null, sl: number | null): EntryDirection {
  if (currentPrice == null || sl == null) return null
  if (sl < currentPrice) return 'buy'
  if (sl > currentPrice) return 'sell'
  return null
}

/**
 * §7.4: エントリー価格は現在値で固定。SL の位置から方向を自動判定。
 * SL/TP はチャート上でクリック配置(SessionPage 経由)。
 */
export function TradePanel({
  activeTrade, currentPrice, onEnter, onExit, loading, digits,
  entryDraft, entryPlacing, pipSize,
  onPlaceSL, onPlaceTP, onClearSL, onClearTP,
}: Props) {
  const step = Math.pow(10, -digits).toFixed(digits)
  const [exitPrice, setExitPrice] = useState('')

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
    // §7.4: SL/TP 両方ある場合は R:R 比率を補助表示する(§9 評価軸と整合)
    const activeRr = (() => {
      if (activeTrade.sl == null || activeTrade.tp == null) return null
      const risk = Math.abs(activeTrade.entry_price - activeTrade.sl)
      if (risk === 0) return null
      const reward = Math.abs(activeTrade.tp - activeTrade.entry_price)
      return Math.round((reward / risk) * 100) / 100
    })()
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
            {activeRr != null && <span className="rr-badge">RR 1:{activeRr}</span>}
          </div>
          {activeTrade.pips_pnl != null && (
            <div className={`pnl ${pnlClass}`}>{activeTrade.pips_pnl > 0 ? '+' : ''}{activeTrade.pips_pnl} pips</div>
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

  // ---- 分析中: エントリー組み立て UI ----
  const direction = deriveDirection(currentPrice, entryDraft.sl)
  const slPips = currentPrice != null && entryDraft.sl != null
    ? pipsBetween(currentPrice, entryDraft.sl, pipSize)
    : null
  const tpPips = currentPrice != null && entryDraft.tp != null
    ? pipsBetween(currentPrice, entryDraft.tp, pipSize)
    : null
  const rr = slPips != null && tpPips != null && slPips > 0
    ? Math.round((tpPips / slPips) * 100) / 100
    : null

  // TP が SL と同じ側 → 不正
  const tpInvalid = (() => {
    if (entryDraft.tp == null || currentPrice == null || direction == null) return false
    if (direction === 'buy') return entryDraft.tp <= currentPrice
    return entryDraft.tp >= currentPrice
  })()

  const ready = currentPrice != null && entryDraft.sl != null && direction != null && !tpInvalid

  async function handleEnter() {
    if (!ready || currentPrice == null || entryDraft.sl == null || direction == null) return
    await onEnter({
      direction,
      price: currentPrice,
      sl: entryDraft.sl,
      tp: entryDraft.tp ?? undefined,
    })
  }

  return (
    <div className="trade-panel">
      <div className="entry-form">
        <div className="entry-current">
          <span className="entry-current-label">現在値</span>
          <span className="entry-current-price">
            {currentPrice != null ? formatPrice(currentPrice, digits) : '—'}
          </span>
          {direction && (
            <span className={`entry-direction-badge ${direction}`}>
              {direction.toUpperCase()}
            </span>
          )}
        </div>

        <div className={`entry-line-row ${entryPlacing === 'sl' ? 'placing' : ''}`}>
          <span className="entry-line-label sl">SL</span>
          <span className="entry-line-value">
            {entryDraft.sl != null
              ? <>{formatPrice(entryDraft.sl, digits)} <span className="entry-line-pips">({slPips} pips)</span></>
              : <span className="entry-line-empty">未配置</span>}
          </span>
          {entryDraft.sl != null ? (
            <button className="entry-line-btn" onClick={onClearSL} disabled={loading}>解除</button>
          ) : (
            <button
              className={`entry-line-btn primary ${entryPlacing === 'sl' ? 'active' : ''}`}
              onClick={onPlaceSL}
              disabled={loading || currentPrice == null}
            >
              {entryPlacing === 'sl' ? 'チャートをクリック…' : '📍 配置'}
            </button>
          )}
        </div>

        <div className={`entry-line-row ${entryPlacing === 'tp' ? 'placing' : ''} ${tpInvalid ? 'invalid' : ''}`}>
          <span className="entry-line-label tp">TP</span>
          <span className="entry-line-value">
            {entryDraft.tp != null
              ? <>{formatPrice(entryDraft.tp, digits)} <span className="entry-line-pips">({tpPips} pips{rr ? `, RR 1:${rr}` : ''})</span></>
              : <span className="entry-line-empty">未配置(任意)</span>}
          </span>
          {entryDraft.tp != null ? (
            <button className="entry-line-btn" onClick={onClearTP} disabled={loading}>解除</button>
          ) : (
            <button
              className={`entry-line-btn ${entryPlacing === 'tp' ? 'active' : ''}`}
              onClick={onPlaceTP}
              disabled={loading || currentPrice == null}
            >
              {entryPlacing === 'tp' ? 'チャートをクリック…' : '📍 配置'}
            </button>
          )}
        </div>

        {tpInvalid && (
          <p className="entry-warn">TP は SL と反対側に配置してください</p>
        )}

        <button
          className={`entry-confirm-btn ${direction ?? ''}`}
          onClick={() => void handleEnter()}
          disabled={loading || !ready}
          title={!ready ? 'SL を配置するとエントリーできます' : ''}
        >
          {direction ? `${direction.toUpperCase()} エントリー` : 'エントリー(SL 未配置)'}
        </button>

        <p className="memo-inline-hint">根拠・シナリオは M キー/メモボタンでメモパネルに書く(§7.3)</p>
      </div>
    </div>
  )
}
