# §17. データモデル(概要)

← [仕様書インデックス](./README.md)

---

「ユーザー入力 = ファイル / 機械生成キャッシュ = SQLite」のハイブリッド構成を採る([§13](./13-data-storage.md))。

- **ファイル管理**: セッション関連、メモテンプレート、AI 分析結果
- **SQLite 管理**(`shared-schema` パッケージ): 市場データキャッシュ、経済指標、Setting、Account、IndicatorConfig

**Session の稼働モード**: training では時系列に1つずつ(1セッション1エントリー完結)。real では複数の Session が並行稼働する([§12.7](./12-live.md#127-ポジション継続管理) 参照)。

## 17.1 セッション情報(ファイル管理)

**session.json に集約**: meta・trade・final_decision・drawings・holding_memos を 1 ファイルにまとめる(読み書きパスのシンプル化のため)。`note.md` と `candidates/*.md` は自由記述・1 ファイル 1 テキストの利便性のため分割を維持。

```
data/sessions/
└── {dir_name}/                       # 例: 20260425-1530-USDJPY-doubletop
    ├── session.json                  # meta + trade + final_decision + drawings + holding_memos を統合
    ├── note.md                       # 横断メモ(§7.2.2)
    ├── candidates/
    │   ├── EURJPY.md                 # 銘柄別メモ(§7.2.1、symbol 名のファイル)
    │   └── USDJPY.md
    └── ai_analysis/                  # AI 分析結果(§11.7)
```

### ディレクトリ命名

`{YYYYMMDD-HHMM}-{symbol}-{name}` (JST 基準、name サニタイズ済み)

- 日時: `presented_at` を JST 整形、不変
- symbol: 作成直後 `pending` → エントリー時に銘柄 / 見送り確定時に `skipped` に rename
- name: 未入力 `untitled` / 編集ごとに rename
- ディレクトリ名は **可読ラベル**。識別は `session.json` の `id`(不変)を使う

### session.json

```json
{
  "id": "20260425-1530-7f3a",          // 不変識別子(YYYYMMDD-HHMM-xxxx 形式)
  "name": "ダブルトップ逆張り",         // 任意のセッション名(§6.1、AI 送信対象外 §11.3.2)
  "started_at": "2026-04-25T06:30:00Z",
  "presented_at": "2026-04-25T06:30:00Z",
  "current_position": "2026-04-25T08:15:00Z",  // 現在の足位置(足送りで更新)
  "mode": "training",                  // training | real
  "settled_at": null,                  // §4.2.1 状態モデル: null=進行中、ISO8601=決着済み
  "indicator_config_id": null,         // §11.8 インジケーター設定バージョン参照

  "trade": {                           // エントリー時のみ。未エントリーは null
    "id": "uuid-...",
    "symbol": "USDJPY",
    "direction": "buy",                // buy | sell
    "entry_tf": "M5",                  // §5.1.5 エントリー時のフォーカス TF。advance 単位 / マーカー描画 TF はこれを参照
    "entry_time": "...",
    "entry_price": 150.0,
    "sl": 149.8,
    "tp": 150.6,
    "exit_time": "...",                // 決済済みならあり
    "exit_price": 150.3,
    "exit_reason": "manual",           // tp | sl | manual
    "pips_pnl": 30.0,                  // 補助指標、実損益 R は動的算出 §9.5
    "pip_size": 0.01,                  // §3.1 エントリー時の pip サイズ snapshot(履歴改竄防止 — broker 変更後も当時の値で計算)
    "amount_pnl": null,                // real のみ
    "lot": null,                       // real のみ
    "mt5_order_id": null               // real のみ
  },

  "final_decision": {                  // 見送り確定時のみ。未確定は null
    "has_entry": false,
    "skip_reason": "..."               // 自由記述、任意
  },

  "drawings": [                        // 描画オブジェクト配列
    {
      "id": 1,
      "symbol": "USDJPY",              // 銘柄別紐付け §5.3 / §5.6
      "kind": "line",                  // line | vline | trendline | channel | fibonacci | wave_label | high_break | low_break
      "data": { ... },                 // 座標データ(kind ごとに異なる。wave_label の wave は文字列 '1'|'2'|'3'|'4'|'5'|'A'|'B'|'C')
      "label": null,
      "timeframe": "H1",               // 描画を行った時間足
      "visible_on_timeframes": null    // null = 既定、配列で個別指定
    }
  ],

  "holding_memos": [                   // real モード保有中メモ
    { "timestamp": "...", "memo": "..." }
  ]
}
```

シナリオ・エントリー根拠・決済所感・振り返り等は **`note.md` か `candidates/{symbol}.md`** に書き、`trade` フィールドには数値情報のみ持たせる([§7](./07-memo.md))。MFE / MAE / 続き観察 OHLC は保存せず、`entry_time` / `exit_time` を起点に `market-data` ヘルパーで都度算出する([§9.5](./09-post-review.md#95-エントリー結果の事後確認))。

### candidates/{symbol}.md(銘柄別メモ)

純粋な Markdown。symbol 名がファイル名(例: `USDJPY.md`)。表示順は symbol アルファベット順。`_meta.json` は持たない:

- エントリー銘柄判定 → `session.json` の `trade.symbol` 参照
- 並び順 → ファイル名アルファベット順
- skip_reason → メモ本文に自由記述([§9.1](./09-post-review.md#91-判断の記録))

### 旧分割形式との互換性

過去には `trade.json` / `final_decision.json` / `drawings.json` / `holding_memos.jsonl` を個別ファイルに保存していた時期があり、その形式のまま残っているセッションディレクトリを読み出せるようコード側は **読み出し時にフォールバック** を持つ:
- session.json に該当フィールドが存在せず、旧個別ファイルが存在する場合のみ、旧ファイルから読む
- 次回 save 時に統合形式で session.json に書き戻され、旧ファイルは削除される(自然移行)

## 17.2 SQLite 管理(`shared-schema` パッケージ)

```
Account (realモード用、MT5から同期)
├─ 残高, 口座通貨, レバレッジ
├─ 証拠金余力
└─ 最終同期時刻

Setting
├─ 対象銘柄リスト
├─ スプレッド設定(銘柄別)
├─ 時間軸プリセット
├─ 事後評価パラメータ
├─ 経済指標表示設定(重要度閾値、表示通貨、シェーディング範囲)
└─ リスク設定(1トレード許容損失%/金額)

IndicatorConfig (インジケーター設定のバージョン管理)
├─ id, 作成日時
├─ is_active (現在有効な設定か)
└─ indicators[] (種類・期間・色などのパラメータ配列)

EconomicEvent
├─ id, 発表日時
├─ 通貨, 指標名, 重要度(1-3)
├─ 実測値, 予想値, 前回値
└─ サプライズ度(計算値)

Ohlc(market-data 管理、TF 別キャッシュ)
├─ symbol, timeframe, timestamp, source(複合 PK)
├─ open, high, low, close, volume
└─ fetched_at
```

メモ見出しテンプレートは `data/memo-templates/{candidate,session-note}.md` で管理する。Setting には保存しない。

## 17.3 ファイル管理にしないデータ(理由)

| 対象 | SQLite 維持の理由 |
|---|---|
| `Ohlc` | 数万〜数十万行、範囲クエリの効率重視。再取得可能な消耗品なので同期外。TF 別に保存 |
| `EconomicEvent` | 数千〜数万行、期間/通貨フィルタの効率重視 |
| `Setting` | 単一行、構造化設定、API 経由の編集が主 |
| `IndicatorConfig` | バージョン履歴の整合性 |
| `Account` | 単一行、MT5 から定期同期 |
| 認証セッション | Starlette SessionMiddleware の標準ストア |
