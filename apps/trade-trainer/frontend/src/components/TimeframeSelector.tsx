import { TIMEFRAMES } from '../constants'

type Props = {
  hiddenTfs: Set<string>
  onToggleVisibility: (tf: string) => void
}

/**
 * 仕様書 §5.1 / §5.1.5: TF 表示 ON/OFF チェックボックスのみ。
 * フォーカス TF はチャートクリックで決まるため、本コンポーネントには radio を持たない。
 */
export function TimeframeSelector({ hiddenTfs, onToggleVisibility }: Props) {
  return (
    <div className="tf-selector">
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
