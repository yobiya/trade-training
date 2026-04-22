import { TIMEFRAMES } from '../constants'

type Props = {
  entryTf: string
  onEntryChange: (tf: string) => void
  hiddenTfs: Set<string>
  onToggleVisibility: (tf: string) => void
}

/**
 * 仕様書 §5.1 エントリー足ラジオ + 表示 TF チェックボックス。
 * TrainingPage と SymbolPickPage で共通利用。
 */
export function TimeframeSelector({ entryTf, onEntryChange, hiddenTfs, onToggleVisibility }: Props) {
  return (
    <div className="tf-selector">
      <span className="tf-selector-label">エントリー足:</span>
      {TIMEFRAMES.map(tf => (
        <label key={`entry-${tf}`} className={`tf-entry-radio ${entryTf === tf ? 'active' : ''}`}>
          <input
            type="radio"
            name="entry-tf"
            checked={entryTf === tf}
            onChange={() => onEntryChange(tf)}
          />
          {tf}
        </label>
      ))}
      <span className="tf-selector-sep">|</span>
      <span className="tf-selector-label">表示:</span>
      {TIMEFRAMES.map(tf => (
        <label key={`show-${tf}`} className={`tf-show-check ${!hiddenTfs.has(tf) ? 'active' : ''}`}>
          <input
            type="checkbox"
            checked={!hiddenTfs.has(tf)}
            onChange={() => onToggleVisibility(tf)}
          />
          {tf}
        </label>
      ))}
    </div>
  )
}
