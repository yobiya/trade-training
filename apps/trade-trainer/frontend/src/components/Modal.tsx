import type { ReactNode } from 'react'

type Props = {
  onClose: () => void
  children: ReactNode
}

/**
 * 画面中央に表示する共通モーダル。backdrop クリックで閉じる、
 * モーダル本体へのクリックはバブリングを止める。
 */
export function Modal({ onClose, children }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
