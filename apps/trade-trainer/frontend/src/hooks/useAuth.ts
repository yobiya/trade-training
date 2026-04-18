import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'

export function useAuth() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    api.auth.me()
      .then(r => setAuthenticated(r.authenticated))
      .catch(() => setAuthenticated(false))
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
