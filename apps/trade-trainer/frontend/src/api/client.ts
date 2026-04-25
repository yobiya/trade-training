import type {
  AdvanceResponse,
  ChartResponse,
  CreateDrawingRequest,
  Drawing,
  EconomicEvent,
  PostReviewResponse,
  SessionCandidate,
  SessionFilter,
  SessionListItem,
  SettingsResponse,
  TradeResponse,
  TradeSession,
  TradingStyle,
} from './types'

export * from './types'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(res.status, text)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  auth: {
    login: (password: string) =>
      request<{ authenticated: boolean }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    logout: () => request<void>('/auth/logout', { method: 'POST' }),
    me: () => request<{ authenticated: boolean }>('/auth/me'),
  },

  sessions: {
    create: (filter?: SessionFilter) =>
      request<TradeSession>('/sessions', {
        method: 'POST',
        body: JSON.stringify(filter ?? {}),
      }),
    list: (limit = 20, offset = 0) =>
      request<SessionListItem[]>(`/sessions?limit=${limit}&offset=${offset}`),
    get: (id: string) => request<TradeSession>(`/sessions/${id}`),
    skip: (id: string, reason?: string, consideredStyles?: string[]) =>
      request<TradeSession>(`/sessions/${id}/skip`, {
        method: 'POST',
        body: JSON.stringify({ reason, considered_styles: consideredStyles }),
      }),
    addCandidate: (id: string, symbol: string, memo?: string) =>
      request<SessionCandidate>(`/sessions/${id}/candidates`, {
        method: 'POST',
        body: JSON.stringify({ symbol, memo }),
      }),
    // ver 1.45: candidate id は symbol そのもの(string)
    updateCandidate: (id: string, candidateSymbol: string, memo: string | null) =>
      request<SessionCandidate>(`/sessions/${id}/candidates/${encodeURIComponent(candidateSymbol)}`, {
        method: 'PATCH',
        body: JSON.stringify({ memo }),
      }),
    deleteCandidate: (id: string, candidateSymbol: string) =>
      request<void>(`/sessions/${id}/candidates/${encodeURIComponent(candidateSymbol)}`, { method: 'DELETE' }),
    close: (id: string) =>
      request<void>(`/sessions/${id}`, { method: 'DELETE' }),
    postReview: (id: string) =>
      request<PostReviewResponse>(`/sessions/${id}/post-review`),
    updateNote: (id: string, note: string | null) =>
      request<TradeSession>(`/sessions/${id}/note`, {
        method: 'PATCH',
        body: JSON.stringify({ note }),
      }),
    updateName: (id: string, name: string | null) =>
      request<TradeSession>(`/sessions/${id}/name`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      }),
  },

  chart: {
    get: (sessionId: string, timeframe = 'M5', bars = 200, before?: number, symbol?: string) => {
      const params = new URLSearchParams({ timeframe, bars: String(bars) })
      if (before !== undefined) {
        // UNIX 秒 → ISO (UTC)
        params.set('before', new Date(before * 1000).toISOString())
      }
      if (symbol) params.set('symbol', symbol)
      return request<ChartResponse>(`/sessions/${sessionId}/chart?${params.toString()}`)
    },
    advance: (sessionId: string, bars = 1) =>
      request<AdvanceResponse>(`/sessions/${sessionId}/advance?bars=${bars}`, { method: 'POST' }),
  },

  trades: {
    getActive: (sessionId: string) =>
      request<TradeResponse | null>(`/sessions/${sessionId}/trade`),
    getLatest: (sessionId: string) =>
      request<TradeResponse | null>(`/sessions/${sessionId}/trade/latest`),
    enter: (sessionId: string, body: {
      symbol: string
      direction: 'buy' | 'sell'
      price: number
      sl: number
      tp?: number
      style_id?: string
    }) =>
      request<TradeResponse>(`/sessions/${sessionId}/trade/enter`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    exit: (sessionId: string, body: { price: number; reason: string }) =>
      request<TradeResponse>(`/sessions/${sessionId}/trade/exit`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  settings: {
    get: () => request<SettingsResponse>('/settings'),
    update: (body: Partial<SettingsResponse>) =>
      request<SettingsResponse>('/settings', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },

  tradingStyles: {
    // ver 1.45: ファイル管理に移行(data/trading-styles/{id}.md)。
    // 編集はテキストエディタ + git で行うため、create / update / delete API は提供しない。
    list: (includeInactive = false) =>
      request<TradingStyle[]>(`/trading-styles${includeInactive ? '?include_inactive=true' : ''}`),
  },

  events: {
    list: (sessionId: string, fromUnix: number, toUnix: number, options?: {
      currencies?: string[]
      importanceMin?: number
    }) => {
      const params = new URLSearchParams({
        from: new Date(fromUnix * 1000).toISOString(),
        to: new Date(toUnix * 1000).toISOString(),
      })
      if (options?.currencies && options.currencies.length > 0) {
        params.set('currencies', options.currencies.join(','))
      }
      if (options?.importanceMin !== undefined) {
        params.set('importance_min', String(options.importanceMin))
      }
      return request<EconomicEvent[]>(`/sessions/${sessionId}/events?${params.toString()}`)
    },
  },

  drawings: {
    list: (sessionId: string, symbol?: string) => {
      const q = symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''
      return request<Drawing[]>(`/sessions/${sessionId}/drawings${q}`)
    },
    create: (sessionId: string, body: CreateDrawingRequest) =>
      request<Drawing>(`/sessions/${sessionId}/drawings`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    // ver 1.45: drawing は session 配下管理のため URL に session_id を含む
    update: (sessionId: string, drawingId: number, body: {
      data?: Record<string, unknown>
      label?: string | null
      visible_on_timeframes?: string[] | null
    }) =>
      request<Drawing>(`/sessions/${sessionId}/drawings/${drawingId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (sessionId: string, drawingId: number) =>
      request<void>(`/sessions/${sessionId}/drawings/${drawingId}`, { method: 'DELETE' }),
  },
}
