# MQL5 ツール

MT5 から経済カレンダーなど Python API で取れないデータを CSV で書き出すためのスクリプト群。

## EconomicCalendarExport.mq5

MT5 の経済カレンダーを CSV に書き出すスクリプト(仕様書 §5.4 / §16 Phase 2c)。

### セットアップ

1. MT5 を起動し、`File → Open Data Folder` でデータフォルダを開く
2. `MQL5/Scripts/` に `EconomicCalendarExport.mq5` をコピー
3. MetaEditor で開き、`F7` でコンパイル(`EconomicCalendarExport.ex5` が生成される)
4. MT5 のナビゲータから任意のチャートへスクリプトをドラッグ
5. 入力パラメータを確認して実行

### 出力

- 出力先: `MQL5/Files/economic_calendar.csv`(MT5 データフォルダ配下)
- 列: `event_time (ISO 8601 UTC), currency, name, importance, actual, forecast, previous`
- 重要度: 1 (低) / 2 (中) / 3 (高)
- 値が無い場合は空文字列

### 入力パラメータ

- `InpMonthsBack`(既定 6): 過去何ヶ月分を取得するか
- `InpMonthsForward`(既定 1): 未来何ヶ月分を取得するか
- `InpImportanceMin`(既定 1): 出力する最低重要度
- `InpOutputFile`(既定 `economic_calendar.csv`): 出力ファイル名

### Python 側との連携

書き出された CSV を `market-data update-events --csv-path <path>` で読み込み、
`economic_events` テーブルに upsert する。

### 運用(日次バッチ)

MT5 スクリプトは MT5 を起動していないと動かないため、以下のいずれかを採用:

- **MT5 手動起動 + 手動実行**: 週末に一度ドラッグして更新
- **MT5 常時起動 + EA 化**: `OnTimer()` で 1 日 1 回 CSV 書き出し + Python 側タスクスケジューラで `update-events` を叩く
