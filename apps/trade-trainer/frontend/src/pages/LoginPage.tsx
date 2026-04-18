import { useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError } from '../api/client'

type Props = { onLogin: (password: string) => Promise<boolean> }

export function LoginPage({ onLogin }: Props) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const ok = await onLogin(password)
      if (!ok) setError('認証に失敗しました')
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('パスワードが違います')
      } else {
        setError('サーバーに接続できません')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <h1>Trade Trainer</h1>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={loading}>
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  )
}
