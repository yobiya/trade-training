# Project: trade-training

## 必読

すべての作業を始める前に必ず以下を読んでから着手すること。

- **[`docs/WORKFLOW.md`](./docs/WORKFLOW.md)** — 仕様書 / 設計 / コードの三層を保つための作業手順。**例外なく従う**
- [`docs/spec/README.md`](./docs/spec/README.md) — 仕様書インデックス(章 / 横断方針 / 変更履歴)
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — 設計ドキュメント(モジュール責務・状態所有・データフロー・横断不変条件)+ [`docs/architecture/drawing-tools.md`](./docs/architecture/drawing-tools.md)(描画モード状態機械)

## タスク種別の判定

ユーザー要求を受けたら、まず以下のいずれかに分類する:

- **A. 仕様変更を伴うタスク**: 機能追加 / UI 改修 / API・データモデル変更 → `WORKFLOW.md §A` のフロー
- **B. バグ修正タスク**: 既存仕様どおりに動かないものを直す → `WORKFLOW.md §B` のフロー

判定後、ユーザーに「このタスクは A / B のどちらと理解しています」と一言で確認してから進む(誤解防止)。

## やってはいけないこと(再掲)

- ✗ コードを先に書いて仕様書 / 設計を後回しにする
- ✗ 静的チェック(`npx tsc --noEmit` / `uv run python -c "import trade_trainer_backend.main"`)をスキップして「確認してください」とユーザーに投げる
- ✗ 設計上の不変条件違反(警告ログ / assert 違反)を見て見ぬふりする
