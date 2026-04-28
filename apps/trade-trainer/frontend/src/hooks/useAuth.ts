import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

export function useAuth() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    api.auth.me()
      .then(r => setAuthenticated(r.authenticated))
      .catch(err => {
        // I-11.6 mount 時取得失敗 = ログのみ(LoginPage 自動誘導でユーザーに自然に伝わるため notify 不要)
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
