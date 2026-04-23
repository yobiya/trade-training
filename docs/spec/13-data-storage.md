# §13. データ保存方針

← [仕様書インデックス](./README.md)

---

## 13.1 市場データキャッシュ
- **ローカル DB**(SQLite)に market-data パッケージがキャッシュを書き込む
- 対象: OHLC(M5)、経済指標
- これは高速化のための技術的キャッシュであり、ユーザー記録の「蓄積」とは性質が異なる

## 13.2 セッション記録
- 進行中セッションの状態のみ DB に保持(銘柄・メモ・描画・時間軸・足位置)
- セッション完了で破棄対象([principles/no-aggregation.md#103-セッションのライフサイクル](./principles/no-aggregation.md#103-セッションのライフサイクル))
- CSV/JSON エクスポートは提供しない([principles/no-aggregation.md](./principles/no-aggregation.md))

## 13.3 同期
- クラウド同期は**実装しない**(シンプル運用)
