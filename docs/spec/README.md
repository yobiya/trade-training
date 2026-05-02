# FX トレーニングアプリ 仕様書

仕様書本文は**章単位 1 ファイル**で管理されています。1 ファイル約 150〜200 行を目安に分割し、横断する方針は `principles/` ハブに集約しています。

## 目次(章順)

| § | タイトル | ファイル |
|---|---|---|
| §1 | 概要 | [01-overview.md](./01-overview.md) |
| §2 | データ基盤 | [02-data-foundation.md](./02-data-foundation.md) |
| §3 | 取引条件 | [03-trading-conditions.md](./03-trading-conditions.md) |
| §4 | セッションフロー | [04-session-flow.md](./04-session-flow.md) |
| §5 | チャート機能 | [05-chart.md](./05-chart.md) |
| §6 | セッション画面(統合フロー) | [06-session-screen.md](./06-session-screen.md) |
| §7 | メモ機能 | [07-memo.md](./07-memo.md) |
| §8 | *(欠番: 旧トレードスタイル機能を撤廃した跡)* | — |
| §9 | 判断結果の事後確認機能 | [09-post-review.md](./09-post-review.md) |
| §10 | *(集計・情報蓄積を採用しない方針 → principles/ へ移管)* | [principles/no-aggregation.md](./principles/no-aggregation.md) |
| §11 | AI 分析機能 | [11-ai-analysis.md](./11-ai-analysis.md) |
| §12 | リアルトレードアプリ(trade-live) | [12-live.md](./12-live.md) |
| §13 | データ保存方針 | [13-data-storage.md](./13-data-storage.md) |
| §14 | UI レイアウト | [14-ui-layout.md](./14-ui-layout.md) |
| §15 | 技術スタック | [15-tech-stack.md](./15-tech-stack.md) |
| §16 | 段階リリース計画 | [16-release-plan.md](./16-release-plan.md) |
| §17 | データモデル(概要) | [17-data-model.md](./17-data-model.md) |
| §18 | 開発優先順位の考え方 | [18-dev-priority.md](./18-dev-priority.md) |

## 横断方針(principles/)

複数章から参照される設計方針は `principles/` 配下のハブファイルに集約しています。

| ハブ | 参照箇所 |
|---|---|
| [no-aggregation.md](./principles/no-aggregation.md)(集計・情報蓄積を採用しない) | §1 / §9.4 / §11.1 / §13 / §15.5 / §16 / §18 |
| [no-tags.md](./principles/no-tags.md)(タグ・構造化選択式入力を採用しない) | §6.4 / §7.1 / §9.1 / §11 / §18 |
| [no-future-info.md](./principles/no-future-info.md)(判断時点で知り得ない情報を出さない) | §5.4 / §6.1 / §9 / §11 |

## トピック索引(章をまたぐ関心ごと)

仕様を変える時に **他のどこを更新すべきか** を 1 表で俯瞰するためのマップです。メモ・統合フロー・AI 分析など密結合トピックは複数章に影響が出るため、漏れなく追える入口として利用してください。

| トピック | 主たる章 | 関連箇所 |
|---|---|---|
| メモ機能 | §7 | §4.1 フロー / §6.3 ★ 候補 / §11.3.3 AI 送信 / §17 Session.note・SessionCandidate.memo / principles/no-tags |
| 1 画面統合フロー(選定とトレーニングの分離廃止) | §6 | §4.1 Phase 2 / §5.3 描画銘柄別 / §17 SessionFinalDecision.symbol 非使用 |
| 描画(銘柄別に紐付け) | §5.3 / §5.6 | §6.1 セッション画面 / §17 Drawing.symbol |
| エントリー / 決済情報の表示 | §5.5 | §6.1 セッション画面 / §17 Trade |
| インジケーター | §5.2 | §11.8 設定スナップショット / §17 IndicatorConfig |
| 経済指標表示 | §5.4 | §2.10 データ取得 / §11.3.2 AI 送信 |
| AI 分析 | §11 | §7 メモ送信 / §9.6 事後情報の送信範囲 / §17 データモデル |
| 判断結果の事後確認(R ベース) | §9 | §4.1 Phase 4 / §6.1 振り返りサイドバー / §11.3 AI 送信 / §17 Trade / §12 step 14 / principles/no-future-info |
| リアルトレード特有機能 | §12 | §7 メモ差分 / §11 AI 分析 / §15.4 trade-live / §17 `mode` フラグ |
| データモデル全体 | §17 | 各章のデータ変更(§7 / §11.8 / §12) |
| タグ・構造化入力を採用しない | principles/no-tags | §6.4 / §7.1 / §9.1 / §11 |
| 集計・蓄積を採用しない | principles/no-aggregation | §9.4 / §11.1 / §13 / §16 |

## 関連ドキュメント

- セットアップ・起動手順: [../Setup.md](../Setup.md)
- **作業手順(必読)**: [../WORKFLOW.md](../WORKFLOW.md)
- **設計ドキュメント**: [../ARCHITECTURE.md](../ARCHITECTURE.md) — トップレベル(全体図 / frontend↔backend 役割境界 / 索引)。詳細は層別ファイル: [backend.md](../architecture/backend.md), [frontend-overview.md](../architecture/frontend-overview.md), [frontend-chart.md](../architecture/frontend-chart.md), [drawing-tools.md](../architecture/drawing-tools.md), [invariants.md](../architecture/invariants.md)
- **変更履歴**: [../CHANGELOG.md](../CHANGELOG.md) — 仕様書の主要な変更履歴(本仕様書には現状のみを記述する方針)
