import { useState } from 'react'
import { NotifyProvider } from './contexts/NotifyContext'
import { useAuth } from './hooks/useAuth'
import { LoginPage } from './pages/LoginPage'
import { SessionListPage } from './pages/SessionListPage'
import { SessionPage } from './pages/SessionPage'
import './index.css'

type View =
  | { page: 'list' }
  | { page: 'session'; sessionId: string }

function AppInner() {
  const { authenticated, login, logout } = useAuth()
  const [view, setView] = useState<View>({ page: 'list' })

  if (authenticated === null) {
    return <div className="loading">読み込み中...</div>
  }

  if (!authenticated) {
    return <LoginPage onLogin={login} />
  }

  if (view.page === 'session') {
    return (
      <SessionPage
        sessionId={view.sessionId}
        onBack={() => setView({ page: 'list' })}
      />
    )
  }

  return (
    <SessionListPage
      onStartNew={id => setView({ page: 'session', sessionId: id })}
      onOpenSession={id => setView({ page: 'session', sessionId: id })}
      onLogout={logout}
    />
  )
}

function App() {
  return (
    <NotifyProvider>
      <AppInner />
    </NotifyProvider>
  )
}

export default App
