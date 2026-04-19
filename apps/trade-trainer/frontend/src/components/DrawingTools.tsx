import type { Drawing } from '../api/client'

type Props = {
  addMode: 'line' | null
  onToggleAddMode: (mode: 'line' | null) => void
  drawings: Drawing[]
  onRemove: (id: number) => void
  /** 価格表示の小数桁数(MT5 symbol_info.digits)。 */
  digits: number
}

export function DrawingTools({ addMode, onToggleAddMode, drawings, onRemove, digits }: Props) {
  const horizontalLines = drawings.filter(d => d.kind === 'line')

  return (
    <div className="drawing-tools">
      <div className="drawing-toolbar">
        <button
          type="button"
          className={`tool-btn ${addMode === 'line' ? 'active' : ''}`}
          onClick={() => onToggleAddMode(addMode === 'line' ? null : 'line')}
          title="クリックでチャートに水平線を追加"
        >
          ➖ 水平線
        </button>
        {addMode === 'line' && (
          <span className="drawing-hint">チャートをクリックで追加 / ESC で中止</span>
        )}
      </div>

      {horizontalLines.length > 0 && (
        <ul className="drawing-list">
          {horizontalLines
            .slice()
            .sort((a, b) => Number(b.data.price ?? 0) - Number(a.data.price ?? 0))
            .map(d => (
              <li key={d.id} className="drawing-item">
                <span className="drawing-kind">水平線</span>
                <span className="drawing-price">{Number(d.data.price).toFixed(digits)}</span>
                {d.timeframe && <span className="drawing-tf">({d.timeframe})</span>}
                <button
                  type="button"
                  className="drawing-remove"
                  onClick={() => onRemove(d.id)}
                  title="削除"
                >×</button>
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
