// バックエンド API のレスポンス・リクエスト型定義。
// スキーマは packages/shared-schema と apps/trade-trainer/backend/schemas に対応。

export type OhlcBar = { t: number; o: number; h: number; l: number; c: number; v: number }

export type SessionListItem = {
  id: string
  symbol: string
  started_at: string
  presented_at: string
  mode: string
  is_suspended: boolean
  is_complete: boolean
}

export type TradeSession = {
  id: string
  symbol: string
  started_at: string
  presented_at: string
  current_position: string
  mode: string
  is_suspended: boolean
  has_active_trade: boolean
  is_complete: boolean
  digits: number  // MT5 symbol_info.digits (価格表示の小数桁数)
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

export type ScenarioInput = {
  scenario_main?: string | null
  entry_basis?: string | null
  tags?: string[]
}

export type ScenarioResponse = {
  scenario_main: string | null
  entry_basis: string | null
  tags: string[]
  exit_memo: string | null
  reflection: string | null
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
  scenario: ScenarioResponse | null
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

export type SessionFilter = {
  date_from?: string
  date_to?: string
  days?: number[]
  sessions?: string[]
}

// 仕様書 §5.3/§5.5: 描画オブジェクト
export type DrawingKind = 'line' | 'trendline' | 'fibonacci'

export type Drawing = {
  id: number
  session_id: string
  kind: DrawingKind
  data: Record<string, unknown>
  label: string | null
  timeframe: string | null
  visible_on_timeframes: string[] | null
}

export type CreateDrawingRequest = {
  kind: DrawingKind
  data: Record<string, unknown>
  label?: string | null
  timeframe?: string | null
  visible_on_timeframes?: string[] | null
}
