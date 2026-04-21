import type {
  AdvanceResponse,
  ChartResponse,
  CreateDrawingRequest,
  Drawing,
  ScenarioInput,
  SessionCandidate,
  SessionFilter,
  SessionListItem,
  StatsSummary,
  StyleStatsRow,
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
    selectSymbol: (id: string, symbol: string, skipReasons?: Record<number, string | null>) =>
      request<TradeSession>(`/sessions/${id}/symbol`, {
        method: 'POST',
        body: JSON.stringify({ symbol, skip_reasons: skipReasons }),
      }),
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
    updateCandidate: (id: string, candidateId: number, memo: string | null) =>
      request<SessionCandidate>(`/sessions/${id}/candidates/${candidateId}`, {
        method: 'PATCH',
        body: JSON.stringify({ memo }),
      }),
    deleteCandidate: (id: string, candidateId: number) =>
      request<void>(`/sessions/${id}/candidates/${candidateId}`, { method: 'DELETE' }),
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
      direction: 'buy' | 'sell'
      price: number
      sl?: number
      tp?: number
      scenario?: ScenarioInput
      style_id?: string
      style_selection_reason?: string
    }) =>
      request<TradeResponse>(`/sessions/${sessionId}/trade/enter`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    exit: (sessionId: string, body: { price: number; reason: string; exit_memo?: string }) =>
      request<TradeResponse>(`/sessions/${sessionId}/trade/exit`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    reflection: (sessionId: string, reflection: string) =>
      request<TradeResponse>(`/sessions/${sessionId}/trade/reflection`, {
        method: 'POST',
        body: JSON.stringify({ reflection }),
      }),
  },

  stats: {
    summary: (symbol?: string) =>
      request<StatsSummary>(`/stats/summary${symbol ? `?symbol=${symbol}` : ''}`),
    byStyle: () => request<StyleStatsRow[]>('/stats/by-style'),
  },

  tradingStyles: {
    list: (includeInactive = false) =>
      request<TradingStyle[]>(`/trading-styles${includeInactive ? '?include_inactive=true' : ''}`),
    create: (body: Omit<TradingStyle, 'is_active'>) =>
      request<TradingStyle>('/trading-styles', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, patch: Partial<Omit<TradingStyle, 'id'>>) =>
      request<TradingStyle>(`/trading-styles/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      request<void>(`/trading-styles/${id}`, { method: 'DELETE' }),
  },

  drawings: {
    list: (sessionId: string) =>
      request<Drawing[]>(`/sessions/${sessionId}/drawings`),
    create: (sessionId: string, body: CreateDrawingRequest) =>
      request<Drawing>(`/sessions/${sessionId}/drawings`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (drawingId: number, body: {
      data?: Record<string, unknown>
      label?: string | null
      visible_on_timeframes?: string[] | null
    }) =>
      request<Drawing>(`/drawings/${drawingId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    delete: (drawingId: number) =>
      request<void>(`/drawings/${drawingId}`, { method: 'DELETE' }),
  },
}
