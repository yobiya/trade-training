import type { Drawing, DrawingKind } from '../api/client'
import { TOOLS } from '../drawing/tools/registry'
import type { WaveValue } from '../drawing/tools/wave_label'

// 推進波 1-5 + 補正波 A/B/C(全て文字列で統一保存)
const IMPULSE_WAVES: readonly WaveValue[] = ['1', '2', '3', '4', '5'] as const
const CORRECTIVE_WAVES: readonly WaveValue[] = ['A', 'B', 'C'] as const

type Props = {
  activeTool: DrawingKind | null
  activeWave: WaveValue | null
  onSelectTool: (tool: DrawingKind | null, wave?: WaveValue) => void
  /** §5.3: フォーカス TF で作成された描画のみが渡される(SessionPage 側でフィルタ済み) */
  drawings: Drawing[]
  focusedTf: string
  onRemove: (id: number) => void
  digits: number
}

// 通常描画ツールの順序(wave_label は波動セクションで別途表示)
const TOOL_ORDER: DrawingKind[] = ['line', 'trendline', 'fibonacci']

function hintFor(tool: DrawingKind, wave: WaveValue | null): string {
  switch (tool) {
    case 'line': return 'チャートをクリックで追加 / ESC で中止'
    case 'trendline': return '2 点をクリックで引く / ESC で中止'
    case 'fibonacci': return '2 点をクリックで引く / ESC で中止'
    case 'wave_label': return `波動 ${wave} を配置 / ESC で中止`
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
    case 'wave_label': return `波動 ${d.data.wave}`
    default: return String(d.kind)
  }
}

export function DrawingTools({
  activeTool, activeWave, onSelectTool, drawings, focusedTf, onRemove, digits,
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
      </div>

      <div className="drawing-toolbar wave-toolbar">
        <span className="wave-label-header">推進</span>
        {IMPULSE_WAVES.map(n => {
          const active = activeTool === 'wave_label' && activeWave === n
          return (
            <button
              key={n}
              type="button"
              className={`tool-btn wave-btn ${active ? 'active' : ''}`}
              onClick={() => onSelectTool(active ? null : 'wave_label', n)}
              title={`波動 ${n}`}
            >
              {n}
            </button>
          )
        })}
        <span className="wave-label-header wave-label-header-abc">補正</span>
        {CORRECTIVE_WAVES.map(n => {
          const active = activeTool === 'wave_label' && activeWave === n
          return (
            <button
              key={n}
              type="button"
              className={`tool-btn wave-btn wave-btn-abc ${active ? 'active' : ''}`}
              onClick={() => onSelectTool(active ? null : 'wave_label', n)}
              title={`補正波 ${n}`}
            >
              {n}
            </button>
          )
        })}
      </div>

      {activeTool && (
        <span className="drawing-hint">{hintFor(activeTool, activeWave)}</span>
      )}

      <div className="drawing-list-header">描画一覧 [{focusedTf}]</div>
      {drawings.length > 0 ? (
        <ul className="drawing-list">
          {drawings.map(d => (
            <li key={d.id} className="drawing-item">
              <span className="drawing-kind">{describe(d, digits)}</span>
              <button
                type="button"
                className="drawing-remove"
                onClick={() => onRemove(d.id)}
                title="削除"
              >×</button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="drawing-list-empty">{focusedTf} に描画なし</div>
      )}
    </div>
  )
}
