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
}

export type SessionCandidate = {
  id: number
  symbol: string
  memo: string | null
  is_selected: boolean
  skip_reason: string | null
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
  digits: number  // MT5 symbol_info.digits (価格表示の小数桁数)
  note: string | null  // §7.2.2 横断メモ
  candidates: SessionCandidate[]
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
  symbol: string
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
  style_id: string | null
}

// 仕様書 §7.2.3 メモテンプレート等の設定
export type SettingsResponse = {
  candidate_memo_template: string | null
  session_note_template: string | null
  memo_template_enabled: boolean
}

// 仕様書 §9.2 / §9.4 セッション単位の事後振り返り
export type StageEval = {
  bars: number                // 10 / 50 / 200
  max_up_pips: number
  max_down_pips: number
  max_abs_pips: number
  label: 'opportunity_loss' | 'correct' | 'neutral'
}

export type CandidateReview = {
  symbol: string
  memo: string | null
  skip_reason: string | null
  ref_price: number | null
  stages: StageEval[]
}

export type SkipReview = {
  symbol: string
  reason: string | null
  considered_styles: string[] | null
  ref_price: number | null
  stages: StageEval[]
}

export type EntryReview = {
  symbol: string
  direction: string
  entry_price: number
  sl: number | null
  tp: number | null
  exit_price: number | null
  exit_reason: string | null
  pips_pnl: number | null
  ref_price: number | null
  stages: StageEval[]
}

export type PostReviewResponse = {
  candidates: CandidateReview[]
  skip: SkipReview | null
  entry: EntryReview | null
}

export type SessionFilter = {
  date_from?: string
  date_to?: string
  days?: number[]
  sessions?: string[]
}

// 仕様書 §8: トレードスタイル
export type TradingStyle = {
  id: string
  name: string
  primary_timeframe: string
  expected_hold_time: string
  expected_rr: string
  typical_sl_pips: string
  description: string | null
  is_active: boolean
}

// 仕様書 §5.3/§5.5: 描画オブジェクト
export type DrawingKind = 'line' | 'trendline' | 'fibonacci' | 'wave_label'

export type Drawing = {
  id: number
  session_id: string
  symbol: string | null
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
  symbol?: string | null
  timeframe?: string | null
  visible_on_timeframes?: string[] | null
}
