import type { ScenarioInput } from '../api/client'

type Props = {
  value: ScenarioInput
  onChange: (v: ScenarioInput) => void
  disabled?: boolean
}

// テキストフィールドの宣言的定義。仕様書 §7 の項目順。
type TextField = {
  key: keyof ScenarioInput & string
  label: string
  placeholder: string
  rows: number
  required: boolean
}

const ENV_FIELDS: TextField[] = [
  { key: 'environment', label: '環境認識 *', placeholder: '上位足のトレンド・相場状況', rows: 3, required: true },
  { key: 'market_view', label: '相場観 *', placeholder: '自分で読んだ通貨強弱', rows: 2, required: true },
  { key: 'event_recognition', label: '指標認識 *', placeholder: '近くの強指標の有無と影響評価(「直近なし」も可)', rows: 2, required: true },
]
const SELECTION_FIELDS: TextField[] = [
  { key: 'symbol_reason', label: '銘柄選定理由 *', placeholder: 'なぜこのペアを選んだか', rows: 2, required: true },
  { key: 'skipped_candidates', label: '比較候補の総評', placeholder: '他候補との全体比較の印象(任意。候補別の詳細は銘柄選定画面のメモで記録)', rows: 2, required: false },
]
const SCENARIO_FIELDS: TextField[] = [
  { key: 'scenario_main', label: 'メインシナリオ *', placeholder: '想定する主要な展開', rows: 3, required: true },
  { key: 'scenario_alt1', label: '代替シナリオ1 *', placeholder: '起こりうる展開パターン 2', rows: 2, required: true },
  { key: 'scenario_alt2', label: '代替シナリオ2', placeholder: '起こりうる展開パターン 3(思いつかない場合は空欄可)', rows: 2, required: false },
  { key: 'wave_count', label: '波動カウント', placeholder: 'エリオット仮説', rows: 2, required: false },
]
const ENTRY_FIELDS: TextField[] = [
  { key: 'entry_basis', label: 'エントリー根拠 *', placeholder: '具体的なトリガー', rows: 2, required: true },
]

export const REQUIRED_SCENARIO_KEYS: (keyof ScenarioInput)[] = [
  ...ENV_FIELDS, ...SELECTION_FIELDS, ...SCENARIO_FIELDS, ...ENTRY_FIELDS,
].filter(f => f.required).map(f => f.key)

export function isScenarioValid(value: ScenarioInput): boolean {
  for (const key of REQUIRED_SCENARIO_KEYS) {
    const v = value[key]
    if (typeof v !== 'string' || v.trim().length === 0) return false
  }
  return true
}

export function ScenarioForm({ value, onChange, disabled }: Props) {
  function setField(key: keyof ScenarioInput, v: string) {
    onChange({ ...value, [key]: v })
  }

  function renderTextField(f: TextField) {
    return (
      <div key={f.key}>
        <label className="scenario-label">{f.label}</label>
        <textarea
          className="scenario-textarea"
          value={(value[f.key] as string | null | undefined) ?? ''}
          onChange={e => setField(f.key, e.target.value)}
          disabled={disabled}
          placeholder={f.placeholder}
          rows={f.rows}
        />
      </div>
    )
  }

  return (
    <div className="scenario-form">
      <div className="scenario-group-title">環境分析</div>
      {ENV_FIELDS.map(renderTextField)}

      <div className="scenario-group-title">選定</div>
      {SELECTION_FIELDS.map(renderTextField)}

      <div className="scenario-group-title">シナリオ</div>
      {SCENARIO_FIELDS.map(renderTextField)}

      <div className="scenario-group-title">エントリー</div>
      {ENTRY_FIELDS.map(renderTextField)}
    </div>
  )
}
