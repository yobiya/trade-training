# §18. 開発優先順位の考え方

← [仕様書インデックス](./README.md)

---

- **共通基盤を最優先**: `shared-schema` `market-data` `common-ui-lib` を最初に設計する。後から規約変更すると全アプリに波及するので、初期から丁寧に
- **データ構造を先に固める**: AI 分析・リアル連携を見越して、シナリオメモ項目・スタイル・保有中メモ・modeフラグは最初から揃える(タグ・自己評価は不採用、[principles/no-tags.md](./principles/no-tags.md) 参照)。ver 1.45 でセッション情報・トレードスタイル・メモテンプレートはファイル管理に統一([§13](./13-data-storage.md) / [§17](./17-data-model.md))。市場データ・経済指標・Setting は SQLite 維持。横断集計はしない([principles/no-aggregation.md](./principles/no-aggregation.md))一方、個別セッションのファイル単位での永続保持と振り返りは許容。
- **market-dataが全ての土台**: データ取得パスがなければ何も始まらない。Phase 1でMT5Provider + キャッシュ層を完成させる
- **アプリ B の MVP は「1 つのセッションを最後まで回せる」最小構成**: チャート表示、エントリー、決済、セッション完了で破棄(集計・履歴保持は [principles/no-aggregation.md](./principles/no-aggregation.md) により不採用)
- **銘柄選定フローは Phase 2 から**: MVP はランダム銘柄直指定で良い
- **AI 分析(§11)は Phase 4 で統合**: 情報蓄積を前提としないため([principles/no-aggregation.md](./principles/no-aggregation.md))、Phase 1-3 の運用期間を待つ必要はない。実装が揃い次第 1 セッション単位で呼び出せるようにする
- **アプリCは最後**: 実発注を伴うため、他アプリが安定してから着手。デモ口座で十分な検証後に実口座へ
- **発注コードの絶対的隔離**: アプリBには発注関連の依存ライブラリ(MT5パッケージの発注系関数)を含めない。market-dataパッケージも取得機能のみで発注APIは露出させない。誤って将来の改修で混入しないよう、CIで依存関係チェックを入れるのも検討
