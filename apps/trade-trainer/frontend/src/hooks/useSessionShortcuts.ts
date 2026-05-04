import { useEffect } from 'react'

type Phase = 'analyzing' | 'holding' | 'reviewing'

type Params = {
  phase: Phase
  /** メモモーダルの開閉トグル(M、フェーズ問わず) */
  setMemoOpen: React.Dispatch<React.SetStateAction<boolean>>
  /** ★ 絞り込みモードの ALL ↔ STAR 切替(F、analyzing のみ) */
  setSymbolMode: React.Dispatch<React.SetStateAction<'all' | 'star'>>
  /** 銘柄を前後へ循環移動([ / ]、analyzing のみ) */
  stepSymbol: (dir: 1 | -1) => void
  /** 現在銘柄の ★ をトグル(S、analyzing のみ) */
  toggleCandidate: () => Promise<void>
}

/**
 * 仕様書 §7.3 (M) / §6.2 ([, ], F, S) のキーボードショートカット。
 *
 * - INPUT / TEXTAREA / contenteditable へのフォーカス中は **すべて** スキップ
 * - `M`: フェーズ問わず
 * - `[ / ] / F / S`: `phase === 'analyzing'` のみ
 *
 * `stepSymbol` / `toggleCandidate` は呼び出し側で `useCallback` 安定化したものを渡す前提。
 */
export function useSessionShortcuts({
  phase, setMemoOpen, setSymbolMode, stepSymbol, toggleCandidate,
}: Params): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault()
        setMemoOpen(v => !v)
        return
      }
      if (phase !== 'analyzing') return
      if (e.key === '[') { e.preventDefault(); stepSymbol(-1) }
      else if (e.key === ']') { e.preventDefault(); stepSymbol(1) }
      else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault()
        setSymbolMode(m => m === 'all' ? 'star' : 'all')
      }
      else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        void toggleCandidate()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, setMemoOpen, setSymbolMode, stepSymbol, toggleCandidate])
}
