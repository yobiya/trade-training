# 05. 技術スタックと運用

← [仕様書インデックス](./README.md)

本ファイルは §13 データ保存・展開、§14 UI レイアウト、§15 技術スタック、§18 開発優先順位を収録します。

---

## 13. データ保存方針

### 13.1 市場データキャッシュ
- **ローカル DB**(SQLite)に market-data パッケージがキャッシュを書き込む
- 対象: OHLC(M5)、経済指標
- これは高速化のための技術的キャッシュであり、ユーザー記録の「蓄積」とは性質が異なる

### 13.2 セッション記録
- 進行中セッションの状態のみ DB に保持(銘柄・メモ・描画・時間軸・足位置)
- セッション完了で破棄対象([§10.3](./03-analysis.md#103-セッションのライフサイクル))
- CSV/JSON エクスポートは提供しない([§10](./03-analysis.md#10-集計情報蓄積を採用しない方針))

### 13.3 同期
- クラウド同期は**実装しない**(シンプル運用)

---

## 14. UIレイアウト

### 14.1 PC版
- **チャート最大化レイアウト**
- サイドパネル(左または右)にシナリオメモ・トレード操作
- サイドパネルは折りたたみ可能

### 14.2 スマホ版
- チャート全画面表示
- タブ切り替えでメモ/操作パネルへ遷移
- 縦持ち・横持ち両対応

---

## 15. 技術スタック

### 15.1 Python環境管理・リポジトリ構成

**Python環境管理: uv**
- **uv**(Astral社製、Rust実装の高速Pythonパッケージマネージャ)を採用
- 各アプリ(B/C)と market-data は**独立した仮想環境**を持つ
- 依存定義は `pyproject.toml`、ロックは `uv.lock` で厳密管理
- 選定理由: pip/poetryの10〜100倍高速、venv互換で学習コストが低い、pyproject.toml対応、Pythonバージョン管理も同一ツールで完結、Windows(MT5環境)でも安定動作

**リポジトリ構成: モノレポ + uvワークスペース**
- 全コンポーネントを単一Gitリポジトリで管理
- uv の**ワークスペース機能**で複数Pythonパッケージを統合管理
- `shared-schema` と `market-data` は共通パッケージとしてローカル参照(ワークスペース内パッケージ)
- `uv sync` 一発で全アプリの環境構築が完了

**ディレクトリ構成**

```
fx-app/ (Gitリポジトリルート)
├── pyproject.toml            # ワークスペース定義
├── uv.lock                   # ロックファイル(ワークスペース全体)
├── .python-version           # Pythonバージョン指定
├── packages/
│   ├── shared-schema/        # DB定義・マイグレーション
│   │   ├── pyproject.toml
│   │   └── src/
│   └── market-data/          # 市場データ取得ライブラリ(ハイブリッドキャッシュ)
│       ├── pyproject.toml
│       └── src/
│           ├── providers/    # MT5Provider など差し替え可能な実装
│           ├── fetcher.py    # オンデマンド取得ロジック
│           ├── cache.py      # SQLiteキャッシュ層
│           ├── accessor.py   # アプリから呼ぶエントリーポイント
│           ├── events.py     # 経済指標取得
│           └── cli.py        # CLI(経済指標日次更新など)
├── apps/
│   ├── trade-trainer/        # アプリB
│   │   ├── backend/
│   │   │   ├── pyproject.toml
│   │   │   └── src/
│   │   └── frontend/
│   │       ├── package.json
│   │       └── src/
│   └── trade-live/        # アプリC
│       ├── backend/
│       │   ├── pyproject.toml
│       │   └── src/
│       └── frontend/
├── libs/
│   └── common-ui-lib/        # 共通UIコンポーネント(npm workspace)
│       ├── package.json
│       └── src/
└── README.md
```

**運用コマンド例**

```bash
# 初回セットアップ(全アプリの環境を一括構築)
uv sync

# 経済指標データの日次更新(タスクスケジューラ経由)
uv run market-data update-events

# 特定アプリの起動
cd apps/trade-trainer/backend && uv run uvicorn app.main:app --reload
cd apps/trade-live/backend && uv run uvicorn app.main:app --reload

# フロントエンドは npm workspace で管理
npm install
npm run dev --workspace=apps/trade-trainer/frontend
```

**フロントエンド側の環境管理**
- **pnpm** または **npm workspaces** でモノレポ内のフロントエンド依存を統合
- `common-ui-lib` は npm ワークスペースパッケージとしてローカル参照
- Node.js バージョンは `.nvmrc` で固定

### 15.2 共通基盤
- **SQLite**(単一ファイルDB、全アプリで共有)
  - **WALモード**で運用(読み書きの並行性確保、マルチアプリ構成に必須)
  - インデックスは `(symbol, timestamp)` を基本に、用途に応じて追加
  - バックアップは単純なファイルコピー(WALモードでは `.backup` コマンド推奨)
  - 選定理由: OLTP向けで本アプリのワークロード(小さな書き込み頻繁、数万行規模の読み込み中心)に適合。枯れたツール群(GUI・ORM・マイグレーション)が揃う
- **shared-schema** パッケージ: SQLAlchemy + alembic でスキーマ定義・マイグレーション管理
- **market-data** パッケージ: 市場データ取得ライブラリ
  - ハイブリッドキャッシュ方式(オンデマンド取得 + SQLite自動キャッシュ)
  - データソース抽象化(MT5、将来Dukascopy等)
  - 経済指標の事前取得(CLI、タスクスケジューラから日次実行)
  - アプリB/Cから呼ばれる
- **common-ui-lib** パッケージ: チャート・描画ツール・シナリオメモフォーム等の共有UIコンポーネント

### 15.3 アプリB: trade-trainer
- バックエンド: **Python** + **FastAPI**
- フロントエンド: **React** + **TypeScript** + **TradingView Lightweight Charts**
- `common-ui-lib` と `market-data`(参照のみ) を使用
- 実行環境: Windows VPS(本番)、手元PC(開発、market-dataはキャッシュ参照モード)
- **発注関連コードを含まない**
- 仮想環境: `apps/trade-trainer/backend/.venv`(uv管理)

### 15.4 アプリC: trade-live
- バックエンド: **Python** + **FastAPI** + **MetaTrader5** パッケージ
- フロントエンド: **React** + **TypeScript** + `common-ui-lib`
- `market-data` でチャート取得、MT5 Python APIで直接発注
- 実行環境: Windows VPS(MT5と同居、発注遅延ほぼゼロ)
- 配色テーマを警告色系にしてトレーニングと区別
- 仮想環境: `apps/trade-live/backend/.venv`(uv管理)

### 15.5 AI 分析の配置
- [§10](./03-analysis.md#10-集計情報蓄積を採用しない方針) により横断集計機能は採用しないため、**独立した集計アプリ(trade-analyzer)は持たない**
- §11 AI 分析は trade-trainer 本体の機能として統合し、セッション詳細画面から 1 セッション単位で呼び出す
- AI 呼び出しは Claude API(バックエンドから直接)、結果はファイルストレージに保存([§11.7](./03-analysis.md#117-分析結果の永続化ファイルストレージ))

### 15.6 運用構成

**実行環境: Windows VPS(XServer VPS Windows等)一台に集約**

| コンポーネント | 配置 |
|---|---|
| MT5本体 | VPS(常時起動、RDPで初期セットアップ) |
| market-data CLI (経済指標日次更新) | VPS(Windowsタスクスケジューラで日次実行) |
| アプリB (trade-trainer) | VPS(Webサーバーとして常時稼働) |
| アプリC (trade-live) | VPS(Webサーバーとして常時稼働) |
| SQLite DB | VPS(全アプリが同一ファイルを参照) |

**アクセス方法**
- クライアント(スマホ・PC)からHTTPSでVPSのWebサーバーへアクセス
- 認証はVPS側で完結(**パスワード認証 + HttpOnly Cookie セッション**)
- モバイル・PC・タブレットどこからでも同じ体験

**認証の方針(単一ユーザー運用)**
- 単一ユーザー前提のため、**パスワード1つのみ**(環境変数 or 設定ファイルで管理)
- FastAPI のセッションミドルウェア(Starlette `SessionMiddleware` 等)で HttpOnly Cookie 管理
- 2 アプリ(B/C)で**同一セッションストア**(SQLite or Redis)を共有し、片方でログインすれば他も有効
- JWT は採用しない: ステートレスの恩恵がない単一ユーザー運用かつ localStorage 格納時の XSS リスクを回避するため
- CSRF 対策は FastAPI 標準(SameSite=Lax Cookie)で対応

**VPSスペック目安**
- 推奨メモリ: 4GB以上(MT5 + 2 アプリ + DB の同居を考慮)
- ストレージ: 10GB以上(主に market-data キャッシュの余裕。セッション記録は [§10](./03-analysis.md#10-集計情報蓄積を採用しない方針) により蓄積しない)
- OS: Windows Server(MT5 Python APIの動作環境)

**MT5の常時稼働**
- Windowsセッション切断後もMT5を稼働させる設定
- MT5が落ちた場合の自動復旧(タスクスケジューラによる監視)
- 定期的な接続状態チェック

**バックアップ**
- SQLite DBファイルを定期的に手元PCへダウンロード
- VPSスナップショット機能(XServer VPSで提供あり)を活用

**開発環境**
- 本番: Windows VPS
- 開発(アプリB/D): 手元PC(Mac/Linux/Windows問わず)で動作可能(market-dataはキャッシュ参照モードで起動)
- 開発(アプリC および market-data のMT5取得パス): VPSにRDP接続して直接開発、またはVPS上のGitリポジトリで作業

### 15.7 テスト戦略

**Python(バックエンド・パッケージ共通)**
- **pytest**: 単体・結合テストの標準
- **pytest-asyncio**: FastAPI の非同期ハンドラテスト
- **httpx**: FastAPI `TestClient` の上位互換、API エンドポイントテストに使用

**フロントエンド**
- **Vitest**: Vite ネイティブの高速テストランナー、Jest 互換 API
- **@testing-library/react**: コンポーネントテスト

**テスト方針(ポリシー)**
- **単体・結合テスト**: 重要ロジックに対して書く(バックエンドの計算・キャッシュ層、フロントのストア/ユーティリティ)
- **コンポーネントテスト**: 描画ツール・シナリオメモなど**分岐の多い UI** のみ
- **E2E テスト**: **当面は省略**(個人利用・単独開発のため)。必要が出た時点で Playwright を後追い導入
- テストカバレッジの数値目標は設けない(形骸化防止)。重要な箇所に確実にテストがある状態を優先

### 15.8 Git 運用

個人単独開発のため、過剰な規約は設けない。

**ブランチ戦略**
- **main 中心(trunk-based)**: 基本は main に直接コミット
- 大きめの機能・実験的変更のみ `feature/<name>` ブランチで作業 → 完了後 main へマージ
- リリースタグは Phase の節目で付与(例: `v0.1-phase1`, `v0.2-phase2a`)

**コミットメッセージ**
- **日本語の簡潔な1行メッセージ** を基本とする(Conventional Commits は導入しない)
- 必要があれば本文で補足説明
- 例: `モノレポ構造を初期化(uvワークスペース + npm workspaces)`

**プッシュ先**
- GitHub(プライベートリポジトリ)を想定
- VPS 側は GitHub から pull する片方向同期

---

## 18. 開発優先順位の考え方

- **共通基盤を最優先**: `shared-schema` `market-data` `common-ui-lib` を最初に設計する。後から規約変更すると全アプリに波及するので、初期から丁寧に
- **データ構造を先に固める**: AI 分析・リアル連携を見越して、シナリオメモ項目・スタイル・保有中メモ・modeフラグは最初から揃える(タグ・自己評価は不採用、[§7.8](./02-trainer.md#78-タグ構造化選択式入力を採用しない方針) 参照)。ただしセッションデータの長期蓄積はしない方針([§10](./03-analysis.md#10-集計情報蓄積を採用しない方針))
- **market-dataが全ての土台**: データ取得パスがなければ何も始まらない。Phase 1でMT5Provider + キャッシュ層を完成させる
- **アプリ B の MVP は「1 つのセッションを最後まで回せる」最小構成**: チャート表示、エントリー、決済、セッション完了で破棄(集計・履歴保持は [§10](./03-analysis.md#10-集計情報蓄積を採用しない方針) により不採用)
- **銘柄選定フローは Phase 2 から**: MVP はランダム銘柄直指定で良い
- **AI 分析(§11)は Phase 4 で統合**: 情報蓄積を前提としないため([§10](./03-analysis.md#10-集計情報蓄積を採用しない方針))、Phase 1-3 の運用期間を待つ必要はない。実装が揃い次第 1 セッション単位で呼び出せるようにする
- **アプリCは最後**: 実発注を伴うため、他アプリが安定してから着手。デモ口座で十分な検証後に実口座へ
- **発注コードの絶対的隔離**: アプリBには発注関連の依存ライブラリ(MT5パッケージの発注系関数)を含めない。market-dataパッケージも取得機能のみで発注APIは露出させない。誤って将来の改修で混入しないよう、CIで依存関係チェックを入れるのも検討
