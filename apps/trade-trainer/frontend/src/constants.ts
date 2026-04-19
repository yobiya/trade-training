// アプリ全体で参照する業務定数。散在を避け一箇所に集約する。
// 仕様書の該当セクションをコメントで併記。

// 仕様書 §2.8 対象銘柄(デフォルト 8 ペア)
export const SYMBOLS: string[] = [
  'USDJPY', 'EURUSD', 'GBPUSD', 'AUDUSD',
  'EURJPY', 'GBPJPY', 'AUDJPY', 'EURGBP',
]

// 仕様書 §5.1 時間軸
export const TIMEFRAMES: string[] = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1']

// 時間足ごとに初回取得するバー本数(仕様書 §5.1 マルチタイムフレーム)
export const BARS_BY_TF: Record<string, number> = {
  M5: 500, M15: 400, M30: 400, H1: 400, H4: 300, D1: 200,
}

// メイン時間足を選んだときに並行表示する上位足(仕様書 §5.1)。
// D1 は最上位のため上位足なしで main のみ表示。
export const UPPER_TFS: Record<string, string[]> = {
  M5: ['M15', 'H1', 'H4'],
  M15: ['H1', 'H4', 'D1'],
  M30: ['H1', 'H4', 'D1'],
  H1: ['H4', 'D1'],
  H4: ['D1'],
  D1: [],
}

// 曜日フィルタ(仕様書 §4.1 時間選定)。値は Monday=0 〜 Sunday=6
export const DAYS_OF_WEEK: { v: number; label: string }[] = [
  { v: 0, label: '月' }, { v: 1, label: '火' }, { v: 2, label: '水' },
  { v: 3, label: '木' }, { v: 4, label: '金' }, { v: 5, label: '土' }, { v: 6, label: '日' },
]

// トレーディングセッション(仕様書 §2.11 JST 基準)。
export const TRADING_SESSIONS: { v: string; label: string }[] = [
  { v: 'tokyo', label: '東京 09-15' },
  { v: 'london', label: 'ロンドン 16-25' },
  { v: 'ny', label: 'NY 22-06' },
]

// 仕様書 §7.4 固定タグ候補
export const PRESET_TAGS: string[] = [
  '押し目買い', '戻り売り', 'ブレイクアウト', 'レンジ逆張り',
  '3波狙い', 'C波狙い', 'ダマシ警戒',
  '指標前', '指標後', '指標スキップ', '指標無風',
]
