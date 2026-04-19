import type { Drawing, DrawingKind } from '../api/client'
import { TOOLS } from '../drawing/tools/registry'

type Props = {
  activeTool: DrawingKind | null
  onSelectTool: (tool: DrawingKind | null) => void
  drawings: Drawing[]
  onRemove: (id: number) => void
  digits: number
}

// 現状 UI で扱うツール(TOOLS に登録されているもののみ)
const TOOL_ORDER: DrawingKind[] = ['line', 'trendline', 'fibonacci']

function hintFor(tool: DrawingKind): string {
  switch (tool) {
    case 'line': return 'チャートをクリックで追加 / ESC で中止'
    case 'trendline': return '2 点をクリックで引く / ESC で中止'
    case 'fibonacci': return '2 点をクリックで引く / ESC で中止'
    default: return ''
  }
}

function describe(d: Drawing, digits: number): string {
  switch (d.kind) {
    case 'line': return `水平線 ${Number(d.data.price).toFixed(digits)}`
    case 'trendline': return 'トレンドライン'
    case 'fibonacci': {
      const pts = d.data.points as Array<{ price: number }> | undefined
      if (pts && pts.length === 2) {
        return `フィボ ${Number(pts[0].price).toFixed(digits)} / ${Number(pts[1].price).toFixed(digits)}`
      }
      return 'フィボ'
    }
    default: return String(d.kind)
  }
}

export function DrawingTools({
  activeTool, onSelectTool, drawings, onRemove, digits,
}: Props) {
  return (
    <div className="drawing-tools">
      <div className="drawing-toolbar">
        {TOOL_ORDER.map(tool => {
          const meta = TOOLS[tool]
          if (!meta) return null
          const active = activeTool === tool
          return (
            <button
              key={tool}
              type="button"
              className={`tool-btn ${active ? 'active' : ''}`}
              onClick={() => onSelectTool(active ? null : tool)}
              title={meta.label}
            >
              {meta.icon} {meta.label}
            </button>
          )
        })}
        {activeTool && (
          <span className="drawing-hint">{hintFor(activeTool)}</span>
        )}
      </div>

      {drawings.length > 0 && (
        <ul className="drawing-list">
          {drawings.map(d => (
            <li key={d.id} className="drawing-item">
              <span className="drawing-kind">{describe(d, digits)}</span>
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
