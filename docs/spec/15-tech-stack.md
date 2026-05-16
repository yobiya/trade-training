# §15. 技術スタック

← [仕様書インデックス](./README.md)

---

## 15.1 Python環境管理・リポジトリ構成

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

## 15.2 共通基盤
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

## 15.3 アプリB: trade-trainer
- バックエンド: **Python** + **FastAPI**
- フロントエンド: **React** + **TypeScript** + **TradingView Lightweight Charts**
- `common-ui-lib` と `market-data`(参照のみ) を使用
- 実行環境: Windows VPS(本番)、手元PC(開発、market-dataはキャッシュ参照モード)
- **発注関連コードを含まない**
- 仮想環境: `apps/trade-trainer/backend/.venv`(uv管理)

## 15.4 アプリC: trade-live
- バックエンド: **Python** + **FastAPI** + **MetaTrader5** パッケージ
- フロントエンド: **React** + **TypeScript** + `common-ui-lib`
- `market-data` でチャート取得、MT5 Python APIで直接発注
- 実行環境: Windows VPS(MT5と同居、発注遅延ほぼゼロ)
- 配色テーマを警告色系にしてトレーニングと区別
- 仮想環境: `apps/trade-live/backend/.venv`(uv管理)

## 15.5 横断アプリの不採用
- [principles/no-aggregation.md](./principles/no-aggregation.md) により横断集計機能は採用しないため、**独立した集計アプリは持たない**
- 振り返りは trade-trainer 本体のセッション詳細画面(§9)で 1 セッション単位で完結させる

## 15.6 運用構成

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
- ストレージ: 10GB以上(主に market-data キャッシュの余裕。セッション記録は [principles/no-aggregation.md](./principles/no-aggregation.md) により蓄積しない)
- OS: Windows Server(MT5 Python APIの動作環境)

**MT5の常時稼働**
- Windowsセッション切断後もMT5を稼働させる設定
- MT5が落ちた場合の自動復旧(タスクスケジューラによる監視)
- 定期的な接続状態チェック

**バックアップ・同期**

| 対象 | 同期(Dropbox 等) | バックアップ |
|---|---|---|
| `data/sessions/`(セッション情報) | **同期推奨** | Dropbox 履歴 + 個別フォルダコピー |
| `data/memo-templates/` | git で管理 | git 履歴 |
| `trading.db`(SQLite: ohlc / economic_events / Setting / 認証セッション) | **同期対象外**(WAL/shm 同期で部分破損リスク。市場データは再取得可能な消耗品) | 定期手元PCダウンロード or VPS スナップショット |

詳細は [§13](./13-data-storage.md) 参照。**Dropbox 同期で複数端末に同じ `data/sessions/` を持ち、ローカル PC ではコピーした分を参照・分析する運用**を想定する(編集は VPS 側に集約)。

**開発環境**
- 本番: Windows VPS
- 開発(アプリB/D): 手元PC(Mac/Linux/Windows問わず)で動作可能(market-dataはキャッシュ参照モードで起動)
- 開発(アプリC および market-data のMT5取得パス): VPSにRDP接続して直接開発、またはVPS上のGitリポジトリで作業

## 15.7 テスト戦略

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

## 15.8 Git 運用

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
