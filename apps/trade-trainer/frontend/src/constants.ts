// アプリ全体で参照する業務定数。散在を避け一箇所に集約する。
// 仕様書の該当セクションをコメントで併記。

// 仕様書 §2.8 対象銘柄(FX 28 ペア + 商品 7 銘柄 = 計 35 銘柄)
export const SYMBOLS: string[] = [
  // FX: USD ストレート
  'USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF',
  // FX: JPY クロス
  'EURJPY', 'GBPJPY', 'AUDJPY', 'NZDJPY', 'CADJPY', 'CHFJPY',
  // FX: EUR クロス
  'EURGBP', 'EURAUD', 'EURNZD', 'EURCAD', 'EURCHF',
  // FX: GBP クロス
  'GBPAUD', 'GBPNZD', 'GBPCAD', 'GBPCHF',
  // FX: AUD / NZD / CAD クロス
  'AUDNZD', 'AUDCAD', 'AUDCHF', 'NZDCAD', 'NZDCHF', 'CADCHF',
  // 貴金属
  'XAUUSD', 'XAGUSD',
  // 暗号通貨
  'BTCUSD', 'ETHUSD',
  // 株価指数
  'US30', 'NAS100', 'JP225',
]

// pip サイズは `SessionResponse.pip_size`(MT5 由来 + carrier 補正)を真実とする(仕様書 §3.1)。
// frontend は table を持たず、session 取得後の `session.pip_size` を読むだけ。

// 仕様書 §5.1 時間軸
export const TIMEFRAMES: string[] = ['M5', 'M15', 'H1', 'H4', 'D1', 'W1', 'MN1']

// 仕様書 §5.1.1: TF を分単位で表現(「+N 本 = entry TF の N バー」換算用)。
// MN1 は月毎日数が異なるため 30 日 = 30 × 24 × 60 = 43200 分 で近似する。
export const TIMEFRAME_MINUTES: Record<string, number> = {
  M5: 5,
  M15: 15,
  H1: 60,
  H4: 240,
  D1: 1440,
  W1: 10080,
  MN1: 43200,
}

// 仕様書 §5.1.3: 初期表示する可視範囲のバー数(全 TF 統一)。backend `_BARS_BY_TF` (400) が
// 取得本数、こちらは画面に映るバー数。縦積みマルチ TF で各チャートのローソク幅が揃うことを
// 優先し、TF 別差をなくして単一値とする。
export const DEFAULT_VISIBLE_BARS = 300

// メイン時間足を選んだときに並行表示する上位足(仕様書 §5.1)。
// MN1 は最上位のため上位足なしで main のみ表示。
export const UPPER_TFS: Record<string, string[]> = {
  M5: ['M15', 'H1', 'H4'],
  M15: ['H1', 'H4', 'D1'],
  H1: ['H4', 'D1', 'W1'],
  H4: ['D1', 'W1', 'MN1'],
  D1: ['W1', 'MN1'],
  W1: ['MN1'],
  MN1: [],
}

// 時間足ごとの描画色(仕様書 §5.3)。
// 作成時の timeframe により描画色を固定し、どの時間足の視点で引かれたかを識別する。
const TIMEFRAME_COLORS: Record<string, string> = {
  M5: '#58a6ff',   // スカイブルー
  M15: '#56d4dd',  // ティール
  H1: '#26a69a',   // 緑
  H4: '#e3b341',   // 黄
  D1: '#f0883e',   // オレンジ
  W1: '#d2a8ff',   // 紫
  MN1: '#ff79c6',  // マゼンタ
}
const DEFAULT_TIMEFRAME_COLOR = '#e3b341'

export function getTimeframeColor(tf: string | null | undefined): string {
  if (!tf) return DEFAULT_TIMEFRAME_COLOR
  return TIMEFRAME_COLORS[tf] ?? DEFAULT_TIMEFRAME_COLOR
}
