import { useContext } from 'react'
import { NotifyContext, type NotifyContextValue } from '../contexts/NotifyContext'

/**
 * 通知(toast)機構の consumer フック(設計 §B I-11.4)。
 * `<NotifyProvider>` 外で呼ぶと throw する(開発時のバグ検知)。
 */
export function useNotify(): NotifyContextValue {
  const ctx = useContext(NotifyContext)
  if (!ctx) {
    throw new Error('useNotify は <NotifyProvider> 内で呼び出してください')
  }
  return ctx
}
