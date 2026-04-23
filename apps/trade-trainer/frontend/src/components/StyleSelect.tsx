import type { TradingStyle } from '../api/client'

type Props = {
  styles: TradingStyle[]
  styleId: string
  onStyleIdChange: (id: string) => void
  disabled?: boolean
}

/**
 * エントリー前のトレードスタイル選択(仕様書 §8.4)。
 * 選択スタイルの想定値(SL 幅・RR 等)を参考表示する。
 * 選定理由は横断メモ(§7.2.2)に自由記述(ここでは入力欄を持たない)。
 */
export function StyleSelect({
  styles, styleId, onStyleIdChange, disabled,
}: Props) {
  const selected = styles.find(s => s.id === styleId)

  return (
    <div className="style-select">
      <label className="scenario-label">トレードスタイル</label>
      <select
        value={styleId}
        onChange={e => onStyleIdChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">— 選択してください —</option>
        {styles.map(s => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.primary_timeframe})
          </option>
        ))}
      </select>

      {selected && (
        <div className="style-detail">
          <span>保有: {selected.expected_hold_time}</span>
          <span>RR: {selected.expected_rr}</span>
          <span>SL: {selected.typical_sl_pips} pips</span>
        </div>
      )}
    </div>
  )
}
