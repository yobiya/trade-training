import { useState } from 'react'
import type { TradingStyle } from '../api/client'
import { Modal } from './Modal'

type Props = {
  styles: TradingStyle[]
  onConfirm: (reason: string, consideredStyles: string[]) => Promise<void>
  onCancel: () => void
}

/**
 * 仕様書 §7.3 層 2 エントリー見送りフォーム。
 * - 見送り理由(必須)
 * - 検討したスタイル(任意、§8.5)
 */
export function SkipEntryModal({ styles, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('')
  const [considered, setConsidered] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  function toggleStyle(id: string) {
    setConsidered(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit() {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await onConfirm(reason.trim(), Array.from(considered))
    } finally {
      setBusy(false)
    }
  }

  const activeStyles = styles.filter(s => s.is_active)

  return (
    <Modal onClose={onCancel}>
      <h2>エントリーを見送る</h2>
      <p className="modal-hint">見送り理由 *(なぜこのペアを入らないと判断したか)</p>
      <textarea
        rows={4}
        value={reason}
        onChange={e => setReason(e.target.value)}
        placeholder="ポイント合致せず / トレンド逆行 / ボラ不足 等、なぜ入らないと判断したか"
        autoFocus
      />

      {activeStyles.length > 0 && (
        <>
          <p className="modal-hint" style={{ marginTop: 12 }}>検討したスタイル(任意、§8.5)</p>
          <div className="skip-styles">
            {activeStyles.map(s => (
              <label key={s.id} className={`skip-style-chip ${considered.has(s.id) ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  checked={considered.has(s.id)}
                  onChange={() => toggleStyle(s.id)}
                />
                {s.name}
              </label>
            ))}
          </div>
        </>
      )}

      <div className="modal-actions">
        <button onClick={onCancel} disabled={busy}>キャンセル</button>
        <button
          className="primary"
          onClick={() => void handleSubmit()}
          disabled={busy || !reason.trim()}
        >
          見送り確定
        </button>
      </div>
    </Modal>
  )
}
