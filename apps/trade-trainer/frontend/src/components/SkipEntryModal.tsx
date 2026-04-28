import { useState } from 'react'
import { Modal } from './Modal'

type Props = {
  onConfirm: (reason: string) => Promise<void>
  onCancel: () => void
}

/**
 * 仕様書 §7.3 層 2 エントリー見送りフォーム。
 * - 見送り理由(必須)
 */
export function SkipEntryModal({ onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit() {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await onConfirm(reason.trim())
    } finally {
      setBusy(false)
    }
  }

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
