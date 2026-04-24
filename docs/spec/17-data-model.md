# §17. データモデル(概要)

← [仕様書インデックス](./README.md)

---

以下のスキーマは `shared-schema` パッケージで定義し、2 アプリ(B/C)すべてが共有する。スキーマ変更時はパッケージを更新し、各アプリをそれに追従させる。

**Session の稼働モード**: training では時系列に1つずつ(1セッション1エントリー完結)。real では複数の Session が並行稼働する([§12.7](./12-live.md#127-ポジション継続管理) 参照)。

```
Session
├─ id, 開始日時, 提示日時(チャート内), 時間フィルタ設定
├─ mode (training | real)
├─ indicator_config_id (当時のインジケーター設定バージョン、分析時の再現用)
├─ note (横断メモ: §7.2.2。通貨強弱・銘柄比較・相場観・シナリオ・
│        見送り理由・決済所感・振り返りなど、セッション全体にまたがる自由記述)
├─ candidates[] (★ で候補化した銘柄のメモ入れ物)
│   ├─ symbol
│   ├─ memo (銘柄別メモ: §7.2.1。銘柄固有の観察・根拠・個別判断の自由記述)
│   ├─ is_selected (エントリーした銘柄か。エントリー時に自動 True、UI では更新しない)
│   ├─ skip_reason (未使用: 統合フロー後は層 1 理由の独立フィールドを持たず、memo に自由記述)
│   └─ 事後データ (10/50/200本先のOHLC。自己評価は §9.3 で OHLC から機械判定し保存しない)
├─ final_decision (セッション見送り時のみ使う skip マーカー)
│   ├─ symbol: 使用停止(統合フロー後はエントリー銘柄を Trade.symbol から取る、§6.1)
│   ├─ has_entry (エントリーしたか)
│   ├─ skip_reason (層 2 セッション見送り時の補足、任意、自由記述)
│   ├─ 検討したスタイル[] (見送り時も記録可、§8.5)
│   └─ 事後データ (§9.3 で OHLC から機械判定)
├─ 中断・再開状態

Trade (エントリー時のみ)
├─ session_id
├─ mode (training | real)
├─ エントリー日時, 方向, 価格, SL, TP
├─ 決済日時, 決済価格, 決済理由(TP/SL/裁量)
├─ pips損益 (補助指標、実損益 R は entry/exit/sl から動的算出 — §9.5)
├─ 金額損益 (realのみ)
├─ ロット (realのみ)
├─ MT5_order_id (realのみ)
└─ style_id (選択したトレードスタイル)

※ MFE / MAE / 続き観察 OHLC(§9.5)は DB に保存せず、
  entry_time / exit_time を起点に `market-data` ヘルパーで都度算出する
  (principles/no-aggregation.md の「蓄積しない」方針と整合)。

※ シナリオ・スタイル選定理由・エントリー根拠・決済所感・振り返りなどは、
  銘柄横断なら Session.note(横断メモ)、銘柄固有なら
  SessionCandidate.memo(銘柄別メモ)に自由記述する。Trade には独立した
  メモフィールドは持たない([§7](./07-memo.md))。

TradingStyle (ユーザー定義のトレードスタイル)
├─ id (文字列キー: 'short', 'mid', 'news' 等)
├─ name (表示名)
├─ primary_timeframe
├─ expected_hold_time
├─ expected_rr
├─ typical_sl_pips
├─ description (運用ルール・説明、自由記述)
└─ is_active (有効/無効フラグ)

HoldingMemo (保有中の任意メモ、Tradeに紐づく)
├─ trade_id
├─ timestamp
└─ メモ本文(自由記述)

Drawing (Sessionに紐づく描画保存)
├─ session_id
├─ symbol (描画対象銘柄、§5.3 / §5.5。銘柄切替時に該当銘柄の描画のみ表示)
├─ 種類 (line / fibonacci / label / trendline)
├─ 座標データ
├─ timeframe (描画を行ったチャートの時間足: M5/M15/H1/H4/D1 等)
├─ visible_on_timeframes (表示対象時間足の配列、JSON)
└─ ラベル文字

Account (realモード用、MT5から同期)
├─ 残高, 口座通貨, レバレッジ
├─ 証拠金余力
└─ 最終同期時刻

Setting
├─ 対象銘柄リスト
├─ スプレッド設定(銘柄別)
├─ 時間軸プリセット
├─ 時間フィルタプリセット
├─ 事後評価パラメータ(lookahead_bars, opportunity_pips, noise_pips、§9.3)
├─ 経済指標表示設定(重要度閾値、表示通貨、シェーディング範囲)
├─ メモ見出しテンプレート(§7.2.3): candidate_memo_template / session_note_template (TEXT)
├─ メモテンプレート有効フラグ(bool、既定 true)
└─ リスク設定(1トレード許容損失%/金額)

IndicatorConfig (インジケーター設定のバージョン管理)
├─ id, 作成日時
├─ is_active (現在有効な設定か)
└─ indicators[] (種類・期間・色などのパラメータ配列)
  例: [{ type: "SMA", period: 20 }, { type: "RSI", period: 14 }]

EconomicEvent
├─ id, 発表日時
├─ 通貨, 指標名, 重要度(1-3)
├─ 実測値, 予想値, 前回値
└─ サプライズ度(計算値)
```

**DB に置かないデータ**

- **AI 分析結果**: `data/ai_analysis/{session_id}/` 配下にファイル保存([§11.7](./11-ai-analysis.md#117-分析結果の永続化ファイルストレージ) 参照)。統計対象外・画像と長文 Markdown を含むため、DB テーブルは設けない
- **市場 OHLC**: `market-data` パッケージが管理するキャッシュ DB(SQLite)側に分離し、本スキーマでは保持しない
