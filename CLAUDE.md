# Project: trade-training

## 必読

すべての作業を始める前に必ず以下を読んでから着手すること。

- **[`docs/WORKFLOW.md`](./docs/WORKFLOW.md)** — 仕様書 / 設計 / コードの三層を保つための作業手順。**例外なく従う**
- [`docs/spec/README.md`](./docs/spec/README.md) — 仕様書インデックス(章 / 横断方針)
- [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) — 仕様書の変更履歴(ver 1.X 単位、append-only)
- 設計ドキュメント(層別に分割):
  - [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — トップレベル(全体図 / **frontend↔backend 役割境界** / 索引)
  - [`docs/architecture/invariants.md`](./docs/architecture/invariants.md) — 横断不変条件 I-1〜I-12(着手前必読)
  - [`docs/architecture/backend.md`](./docs/architecture/backend.md) — backend + market-data
  - [`docs/architecture/frontend-overview.md`](./docs/architecture/frontend-overview.md) — frontend 全体構造(画面 / 状態 / hooks / フロー)
  - [`docs/architecture/frontend-chart.md`](./docs/architecture/frontend-chart.md) — Chart 関連(**座標系 / LWC 境界 / TF 間 projection 規約**)
  - [`docs/architecture/drawing-tools.md`](./docs/architecture/drawing-tools.md) — 描画モード状態機械

## タスク種別の判定

ユーザー要求を受けたら、まず以下のいずれかに分類する:

- **A. 仕様変更を伴うタスク**: 機能追加 / UI 改修 / API・データモデル変更 → `WORKFLOW.md §A` のフロー
- **B. バグ修正タスク**: 既存仕様どおりに動かないものを直す → `WORKFLOW.md §B` のフロー

判定後、ユーザーに「このタスクは A / B のどちらと理解しています」と一言で確認してから進む(誤解防止)。

### A-2 設計レビューが必須になるケース(skip 厳禁)

A 種のうち、以下のどれか 1 つでも当てはまるものは **コードに着手する前に WORKFLOW §A-2 / §A-2.1 チェックリストを必ず通す**。「機能としては小さいから」と省略してはいけない:

- 既存のモジュールスコープ state / ref / memory(`xMemory.ts` 等)と新機能が状態を共有する
- 既存の lifecycle 戦略(`<X key={...}>` の remount / useEffect 依存配列・順序保証)に新しい入力源が増える
- キャッシュ層(任意の粒度)の追加 / 削除
- ライブラリ(lightweight-charts 等)の暗黙副作用と新機能が干渉する可能性がある

具体的にやること: 関連する設計ファイル(`docs/ARCHITECTURE.md` または `docs/architecture/*.md`)のセクションを **先に**更新し、新 state と既存 state の干渉が文章で追える状態にする。これを飛ばさない。

## ファイル作成規約

### `.ps1` (PowerShell スクリプト) は UTF-8 with BOM で保存する

- 新規作成・編集問わず、`.ps1` ファイルは **UTF-8 with BOM (先頭 `EF BB BF`)** で保存する
- ASCII 専用(日本語コメント無し)でも、将来日本語追加時の事故防止のため BOM を付ける
- 理由: Windows PowerShell 5.1 (`powershell.exe`) は BOM 無しの `.ps1` を ANSI (Windows-1252)
  として読み、日本語コメントの UTF-8 列を誤デコードしてパースエラー
  (`Unexpected token '}'` 等)で停止する。pwsh 7 は BOM 無しでも UTF-8 として読むため
  開発時に気付かないが、ユーザー実行環境(別 clone / 別 shell)で破綻する
- 確認方法: `[System.IO.File]::ReadAllBytes('path').ps1')[0..2]` の戻り値が `239,187,191`
- BOM 付与方法:
  ```powershell
  $utf8Bom = New-Object System.Text.UTF8Encoding($true)
  $content = Get-Content -Raw -Encoding UTF8 'scripts\xxx.ps1'
  [System.IO.File]::WriteAllText((Resolve-Path 'scripts\xxx.ps1').Path, $content, $utf8Bom)
  ```

## やってはいけないこと(再掲)

- ✗ コードを先に書いて仕様書 / 設計を後回しにする
- ✗ 静的チェック(`npx tsc --noEmit` / `uv run python -c "import trade_trainer_backend.main"`)をスキップして「確認してください」とユーザーに投げる
- ✗ 設計上の不変条件違反(警告ログ / assert 違反)を見て見ぬふりする
- ✗ 仕様書本文や設計書本文に `ver 1.X で〜に変更` のような時系列マーカーを書く(変更履歴は `docs/CHANGELOG.md` に集約する)
- ✗ 既存のモジュール状態 / lifecycle が絡む新機能を、設計ファイル(`ARCHITECTURE.md` または `architecture/*.md`)の該当節を更新せずに実装する(WORKFLOW §A-2.1 チェックリスト未通過のままコードに進まない)
- ✗ バグ修正で局所対処(clamp / フォールバック / フラグ追加 等)を 3 回以上重ねる(2 回ダメなら設計見直しに戻る、WORKFLOW §B-1)
