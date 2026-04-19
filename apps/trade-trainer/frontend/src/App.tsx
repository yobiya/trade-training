import { useState } from 'react'
import { useAuth } from './hooks/useAuth'
import { LoginPage } from './pages/LoginPage'
import { SessionListPage } from './pages/SessionListPage'
import { SymbolPickPage } from './pages/SymbolPickPage'
import { TrainingPage } from './pages/TrainingPage'
import './index.css'

type View =
  | { page: 'list' }
  | { page: 'symbol-pick'; sessionId: string }
  | { page: 'training'; sessionId: string }

function App() {
  const { authenticated, login, logout } = useAuth()
  const [view, setView] = useState<View>({ page: 'list' })

  if (authenticated === null) {
    return <div className="loading">読み込み中...</div>
  }

  if (!authenticated) {
    return <LoginPage onLogin={login} />
  }

  if (view.page === 'symbol-pick') {
    return (
      <SymbolPickPage
        sessionId={view.sessionId}
        onSelected={() => setView({ page: 'training', sessionId: view.sessionId })}
        onBack={() => setView({ page: 'list' })}
      />
    )
  }

  if (view.page === 'training') {
    return (
      <TrainingPage
        sessionId={view.sessionId}
        onBack={() => setView({ page: 'list' })}
      />
    )
  }

  return (
    <SessionListPage
      onStartNew={id => setView({ page: 'symbol-pick', sessionId: id })}
      onOpenSession={id => setView({ page: 'training', sessionId: id })}
      onLogout={logout}
    />
  )
}

export default App
