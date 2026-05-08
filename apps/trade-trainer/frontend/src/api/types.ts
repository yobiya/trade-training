// バックエンド API のレスポンス・リクエスト型定義。
// スキーマは packages/shared-schema と apps/trade-trainer/backend/schemas に対応。

export type OhlcBar = { t: number; o: number; h: number; l: number; c: number; v: number }

export type SessionListItem = {
  id: string
  symbol: string
  started_at: string
  presented_at: string
  mode: string
  is_settled: boolean         // §4.2.1 状態モデル
  name: string | null         // §6.1 任意のセッション名
  r_pnl: number | null        // §9.5 実損益 R(決済済みのみ)
  pips_pnl: number | null     // 補助
  settled_at: string | null
}

export type SessionCandidate = {
  id: string                   // 銘柄別メモはファイル管理のため id = symbol そのもの
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
  is_settled: boolean   // §4.2.1 状態モデル
  has_active_trade: boolean
  digits: number  // MT5 symbol_info.digits (価格表示の小数桁数)
  pip_size: number  // §3.1 銘柄の pip サイズ(MT5 由来 + carrier 補正)
  name: string | null  // §6.1 任意のセッション名
  note: string | null  // §7.2.2 横断メモ
  candidates: SessionCandidate[]
  settled_at: string | null
}

export type ChartStackEntry = {
  timeframe: string
  bars: OhlcBar[]
}

export type ChartStackResponse = {
  symbol: string
  current_position: string
  stacks: ChartStackEntry[]
}

export type ChartHistoryResponse = {
  timeframe: string
  bars: OhlcBar[]
}

export type AdvanceResponse = {
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
  entry_tf: string                           // §5.1.5 エントリー時のフォーカス TF
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

// §2.8 銘柄一覧(`config/symbols.toml` の default_active を宣言順)
export type SymbolsListResponse = {
  symbols: string[]
}

// 仕様書 §5.4 経済指標表示の設定
// §7.2.3 メモテンプレートはリポジトリ内 Markdown ファイル管理(data/memo-templates/)へ移行したため
// API レスポンスに含まれない。
export type SettingsResponse = {
  event_importance_threshold: number
  event_currencies: string[] | null
  event_shading_before_min: number
  event_shading_after_min: number
}

// §11 AI 分析
export type AIHistoryEntry = {
  id: string
  hash: string
  model: string
  input_tokens: number | null
  output_tokens: number | null
  cost_yen: number | null
  created_at: string
}

export type AIRunResponse = {
  entry: AIHistoryEntry
  report_md: string
  cached: boolean
}

// 仕様書 §5.4 経済指標
export type EconomicEvent = {
  id: number
  event_time: string       // ISO 8601 UTC
  currency: string
  name: string
  importance: number       // 1-3
  actual: number | null
  forecast: number | null
  previous: number | null
  surprise: number | null
}

// 仕様書 §9 判断結果の事後確認機能(R 主表示 + pips 補助、ラベル判定なし — principles/no-tags)
export type StageEval = {
  bars: number                // 10 / 50 / 200
  max_up_pips: number
  max_down_pips: number
  max_abs_pips: number
  max_up_r: number | null     // R 単位(r_unit_pips が null の場合 null)
  max_down_r: number | null
  max_abs_r: number | null
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
  ref_price: number | null
  stages: StageEval[]
}

// §9.5 エントリー結果の事後確認
export type EntryReview = {
  symbol: string
  direction: string
  entry_price: number
  sl: number | null
  tp: number | null
  exit_price: number | null
  exit_reason: string | null
  pips_pnl: number | null        // 補助指標
  ref_price: number | null
  r_unit_pips: number | null     // Trade.sl 由来の R 基準
  stages: StageEval[]
  // §9.5: 保有期間の MFE/MAE、実損益 R、続き観察
  mfe_r: number | null
  mae_r: number | null
  mfe_pips: number | null
  mae_pips: number | null
  r_pnl: number | null
  continuation_bars: number
  continuation_available: boolean
}

export type PostReviewResponse = {
  candidates: CandidateReview[]
  skip: SkipReview | null
  entry: EntryReview | null
}

// 仕様書 §5.3/§5.5: 描画オブジェクト
export type DrawingKind = 'line' | 'vline' | 'trendline' | 'fibonacci' | 'wave_label'

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
