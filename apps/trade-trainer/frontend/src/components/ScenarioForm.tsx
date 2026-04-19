import type { ScenarioInput } from '../api/client'

// 仕様書 §7.4 固定タグ候補
const PRESET_TAGS = [
  '押し目買い', '戻り売り', 'ブレイクアウト', 'レンジ逆張り',
  '3波狙い', 'C波狙い', 'ダマシ警戒',
  '指標前', '指標後', '指標スキップ', '指標無風',
]

type Props = {
  value: ScenarioInput
  onChange: (v: ScenarioInput) => void
  disabled?: boolean
}

export function ScenarioForm({ value, onChange, disabled }: Props) {
  const tags = value.tags ?? []

  function toggleTag(t: string) {
    const next = tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t]
    onChange({ ...value, tags: next })
  }

  function addCustomTag(input: string) {
    const trimmed = input.trim().replace(/^#/, '')
    if (!trimmed || tags.includes(trimmed)) return
    onChange({ ...value, tags: [...tags, trimmed] })
  }

  function onCustomKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      addCustomTag(e.currentTarget.value)
      e.currentTarget.value = ''
    }
  }

  return (
    <div className="scenario-form">
      <label className="scenario-label">メモ本文</label>
      <textarea
        className="scenario-textarea"
        value={value.scenario_main ?? ''}
        onChange={e => onChange({ ...value, scenario_main: e.target.value })}
        disabled={disabled}
        placeholder="想定する主要な展開"
        rows={3}
      />

      <label className="scenario-label">エントリー根拠</label>
      <textarea
        className="scenario-textarea"
        value={value.entry_basis ?? ''}
        onChange={e => onChange({ ...value, entry_basis: e.target.value })}
        disabled={disabled}
        placeholder="具体的なトリガー"
        rows={2}
      />

      <label className="scenario-label">タグ</label>
      <div className="tag-chips">
        {PRESET_TAGS.map(t => (
          <button
            key={t}
            type="button"
            className={`chip ${tags.includes(t) ? 'active' : ''}`}
            onClick={() => toggleTag(t)}
            disabled={disabled}
          >#{t}</button>
        ))}
        {tags.filter(t => !PRESET_TAGS.includes(t)).map(t => (
          <button
            key={t}
            type="button"
            className="chip active custom"
            onClick={() => toggleTag(t)}
            disabled={disabled}
            title="クリックで削除"
          >#{t} ×</button>
        ))}
      </div>
      <input
        type="text"
        className="scenario-custom-tag"
        placeholder="カスタムタグ(Enter で追加)"
        onKeyDown={onCustomKey}
        disabled={disabled}
      />
    </div>
  )
}
