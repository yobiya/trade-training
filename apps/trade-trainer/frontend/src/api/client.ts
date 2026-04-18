const BASE = '/api'

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

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type OhlcBar = { t: number; o: number; h: number; l: number; c: number; v: number }

export type TradeSession = {
  id: string
  presented_at: string
  current_position: string
  mode: string
  is_suspended: boolean
  symbol: string | null
  has_entry: boolean | null
}

export type ChartResponse = {
  bars: OhlcBar[]
  current_position: string
  timeframe: string
}

export type AdvanceResponse = {
  new_bars: OhlcBar[]
  current_position: string
  trade_auto_closed: boolean
  trade_exit_reason: string | null
  trade_exit_price: number | null
  trade_pips_pnl: number | null
}

export type TradeResponse = {
  id: string
  direction: 'buy' | 'sell'
  entry_price: number
  sl: number | null
  tp: number | null
  entry_time: string
  exit_price: number | null
  exit_reason: string | null
  exit_time: string | null
  pips_pnl: number | null
  is_open: boolean
}

export type StatsSummary = {
  total_trades: number
  win_count: number
  loss_count: number
  win_rate: number
  total_pips: number
  avg_pips_per_trade: number
  profit_factor: number
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
    create: (symbol: string) =>
      request<TradeSession>('/sessions', {
        method: 'POST',
        body: JSON.stringify({ symbol }),
      }),
    list: (page = 1, per_page = 20) =>
      request<{ items: TradeSession[]; total: number; page: number; per_page: number }>(
        `/sessions?page=${page}&per_page=${per_page}`,
      ),
    get: (id: string) => request<TradeSession>(`/sessions/${id}`),
    skip: (id: string) =>
      request<TradeSession>(`/sessions/${id}/skip`, { method: 'POST' }),
  },

  chart: {
    get: (sessionId: string, timeframe = 'M5', bars = 200) =>
      request<ChartResponse>(`/sessions/${sessionId}/chart?timeframe=${timeframe}&bars=${bars}`),
    advance: (sessionId: string, bars = 1) =>
      request<AdvanceResponse>(`/sessions/${sessionId}/advance?bars=${bars}`, { method: 'POST' }),
  },

  trades: {
    getActive: (sessionId: string) =>
      request<TradeResponse | null>(`/sessions/${sessionId}/trade`),
    enter: (sessionId: string, body: { direction: 'buy' | 'sell'; price: number; sl?: number; tp?: number }) =>
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

  stats: {
    summary: (symbol?: string) =>
      request<StatsSummary>(`/stats/summary${symbol ? `?symbol=${symbol}` : ''}`),
  },
}
