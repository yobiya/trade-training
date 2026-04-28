import { createContext, useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * 通知 (toast) 機構(設計 §B I-11.4)。
 *
 * - 全コンポーネントから `useNotify()` で notify 呼び出し可能
 * - `<NotifyProvider>` を `App.tsx` の最上位に配置(認証前 LoginPage でも利用可能)
 * - 致命的(モーダル単位の操作不能)エラーは local state `setError` で扱い、本機構は使わない
 */

export type NotifyLevel = 'info' | 'warn' | 'error'

export type NotifyMessage = {
  id: number
  text: string
  level: NotifyLevel
}

export type NotifyContextValue = {
  messages: NotifyMessage[]
  notify: (text: string, level?: NotifyLevel) => void
  dismiss: (id: number) => void
}

export const NotifyContext = createContext<NotifyContextValue | null>(null)

const AUTO_DISMISS_MS = 5000

export function NotifyProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<NotifyMessage[]>([])
  const idCounterRef = useRef(0)

  const dismiss = useCallback((id: number) => {
    setMessages(prev => prev.filter(m => m.id !== id))
  }, [])

  const notify = useCallback((text: string, level: NotifyLevel = 'info') => {
    const id = ++idCounterRef.current
    setMessages(prev => [...prev, { id, text, level }])
    setTimeout(() => {
      setMessages(prev => prev.filter(m => m.id !== id))
    }, AUTO_DISMISS_MS)
  }, [])

  const value = useMemo<NotifyContextValue>(
    () => ({ messages, notify, dismiss }),
    [messages, notify, dismiss],
  )

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <NotifyToasts messages={messages} onDismiss={dismiss} />
    </NotifyContext.Provider>
  )
}

function NotifyToasts({ messages, onDismiss }: { messages: NotifyMessage[]; onDismiss: (id: number) => void }) {
  if (messages.length === 0) return null
  return (
    <div className="notify-stack" role="status" aria-live="polite">
      {messages.map(m => (
        <button
          key={m.id}
          type="button"
          className={`notify-toast notify-toast--${m.level}`}
          onClick={() => onDismiss(m.id)}
          title="クリックで閉じる"
        >
          {m.text}
        </button>
      ))}
    </div>
  )
}
