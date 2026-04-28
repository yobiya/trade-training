import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

export function useAuth() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    api.auth.me()
      .then(r => setAuthenticated(r.authenticated))
      .catch(err => {
        // FIXME (I-11.1): ログ追加済。I-11.4 については「未認証」状態は LoginPage への自動誘導で
        // ユーザーに自然に伝わるため、追加 notify は不要と判断(セッション切れの一般的挙動)。
        console.warn('[useAuth] me() failed, treating as unauthenticated', err)
        setAuthenticated(false)
      })
  }, [])

  const login = useCallback(async (password: string) => {
    const r = await api.auth.login(password)
    setAuthenticated(r.authenticated)
    return r.authenticated
  }, [])

  const logout = useCallback(async () => {
    await api.auth.logout()
    setAuthenticated(false)
  }, [])

  return { authenticated, login, logout }
}
