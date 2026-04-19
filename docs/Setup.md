# セットアップと起動手順

このドキュメントは fx-trading モノレポの開発環境構築と、各アプリの起動手順・設定ファイルをまとめたものです。

プロジェクト全体の仕様については [Specification.md](../Specification.md) を参照してください。

---

## 1. 前提ツール

| ツール  | バージョン | 管理ファイル         |
| ------- | ---------- | -------------------- |
| Python  | 3.13       | `.python-version`    |
| Node.js | 24         | `.nvmrc`             |
| uv      | 0.11+      | —                    |
| npm     | 11+        | —                    |

- `uv` は Python 側ワークスペース（`packages/`, `apps/*/backend`）の依存解決と仮想環境管理に使用します。
- `npm` は Node 側ワークスペース（`libs/common-ui-lib`, `apps/*/frontend`）の依存管理に使用します。

---

## 2. 初回セットアップ

リポジトリルートで以下を実行します。

```bash
# Python ワークスペース（全 backend + packages）
uv sync

# Node ワークスペース(全 frontend + libs)
npm install
```

`uv sync` により `.venv/` がルートに作られ、`packages/shared-schema`、`packages/market-data`、`apps/*/backend` が editable install されます。

---

## 3. 設定ファイル

### 3.1 バックエンド環境変数(`.env`)

`trade-trainer-backend` は `pydantic-settings` で `.env` を読み込みます。プレフィックスは `TRAINER_` です。

**配置場所**: バックエンドを起動するカレントディレクトリ（通常はリポジトリルート、または `apps/trade-trainer/backend/`）。

| キー                         | デフォルト                                | 用途                                     |
| ---------------------------- | ----------------------------------------- | ---------------------------------------- |
| `TRAINER_DB_PATH`            | `trading.db`                              | SQLite データベースのパス                |
| `TRAINER_APP_PASSWORD`       | `changeme`                                | ログイン画面のパスワード                 |
| `TRAINER_SECRET_KEY`         | `change-this-secret-key-to-32plus-chars`  | セッション Cookie 署名鍵(32 文字以上)    |
| `TRAINER_HOST`               | `0.0.0.0`                                 | バインドホスト                           |
| `TRAINER_PORT`               | `8001`                                    | バインドポート                           |
| `TRAINER_HISTORY_MIN_DAYS`   | `30`                                      | 直近 N 日は出題しない                    |
| `TRAINER_HISTORY_MAX_DAYS`   | `1825`                                    | 最大 N 日遡って出題                      |
| `TRAINER_USE_MT5`            | `False`                                   | MT5 プロバイダを有効化(Windows + MT5 起動済み環境のみ) |

`.env` の最小例:

```env
TRAINER_APP_PASSWORD=your-password-here
TRAINER_SECRET_KEY=please-replace-with-a-random-32plus-char-string
```

`.env` は `.gitignore` 済みでコミットされません。

### 3.2 スプレッド設定(`config/spreads.toml`)

銘柄ごとのスプレッド(pips)を保持するトグル。MT5 デモ接続前の暫定値として使います。詳細は [Specification.md §3](../Specification.md) 参照。

```toml
[spreads]
USDJPY = 1.0
EURUSD = 0.6
# ...
```

### 3.3 バージョン固定ファイル

- `.python-version` … `uv` / pyenv が参照する Python のバージョン。
- `.nvmrc` … `nvm use` で Node のバージョンを切り替える際に参照。

### 3.4 ワークスペース定義

- `pyproject.toml`(ルート) … `[tool.uv.workspace]` で Python ワークスペースのメンバーを列挙。
- `package.json`(ルート) … `workspaces` で Node ワークスペースのメンバーを列挙。

---

## 4. アプリの起動手順(trade-trainer)

バックエンドとフロントエンドは別プロセスで起動します。開発時は 2 つのターミナルを開く想定です。

### 4.1 バックエンド(FastAPI)

```bash
cd apps/trade-trainer/backend
uv run uvicorn trade_trainer_backend.main:app --reload --port 8001
```

- 起動ログに `Application startup complete.` が出れば OK。
- ヘルスチェック: `curl http://localhost:8001/health`
- 初回起動時に `TRAINER_DB_PATH` が指すパスへ SQLite が作成され、シードが投入されます。
- `--reload` はコード変更を検知して自動再起動しますが、`config.py` など一部の変更は手動再起動が必要です。

### 4.2 フロントエンド(Vite + React)

```bash
npm run dev --workspace=apps/trade-trainer/frontend
```

- 既定で `http://localhost:5173` で起動します(ポートは `vite.config.ts` で定義)。
- `/api/*` へのリクエストは `http://localhost:8001`(バックエンド)へプロキシされます(CORS 回避のため)。
- ブラウザで `http://localhost:5173` を開き、`TRAINER_APP_PASSWORD` で設定したパスワードでログインします。

### 4.3 ワンコマンド起動(PowerShell)

Windows 環境向けに `scripts/dev.ps1` を用意しています。既定では backend と frontend を別ウィンドウで同時起動します。

```powershell
# リポジトリルートで実行
.\scripts\dev.ps1              # 両方起動(別ウィンドウ)
.\scripts\dev.ps1 -BackendOnly  # backend のみ
.\scripts\dev.ps1 -FrontendOnly # frontend のみ
.\scripts\dev.ps1 -NoNewWindow  # 現在のウィンドウでバックグラウンドジョブ化
```

初回実行時に実行ポリシーで弾かれる場合は、PowerShell を管理者なしで開き以下を一度だけ実行:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 4.4 よく使う npm スクリプト

フロントエンド側のスクリプト(`apps/trade-trainer/frontend/package.json`):

| コマンド                                             | 内容                      |
| ---------------------------------------------------- | ------------------------- |
| `npm run dev --workspace=apps/trade-trainer/frontend`     | 開発サーバ起動            |
| `npm run build --workspace=apps/trade-trainer/frontend`   | TypeScript + Vite でビルド |
| `npm run lint --workspace=apps/trade-trainer/frontend`    | ESLint                    |
| `npm run preview --workspace=apps/trade-trainer/frontend` | ビルド結果のプレビュー    |
| `npm run test --workspace=apps/trade-trainer/frontend`    | Vitest                    |

---

## 5. MT5 データソースの利用

既定ではキャッシュ参照モードで起動します(`TRAINER_USE_MT5=False`)。MT5 から実際に価格データを取得するには以下が必要です。

**前提**
- Windows(`MetaTrader5` Python パッケージは Windows 専用)
- MT5 ターミナルがインストール・起動済み、ブローカーへログイン済み
- `MetaTrader5` パッケージが `uv sync` 時にインストールされていること(`market-data` の optional-dependencies `mt5`)

**接続確認と利用可能期間の検証**

```bash
# MT5 ターミナルへの接続確認
uv run market-data check-connection

# 銘柄の M5 データが 5 年分取得可能か検証(仕様書 §16 Phase 1 出口条件)
uv run market-data verify-range USDJPY
uv run market-data verify-range EURUSD
# 他銘柄も同様に確認
```

※ bash から実行すると日本語出力が文字化けします。PowerShell で実行してください。

**MT5 を有効化した起動**

`.env` に `TRAINER_USE_MT5=True` を追加してバックエンドを再起動すると、キャッシュに無い範囲が MT5 から取得されます(一度取得した範囲は SQLite にキャッシュされ、以降は MT5 が落ちていても利用可)。

---

## 6. トラブルシュート

- **ログイン後に画面が真っ白**: 古いセッション Cookie が残っていることがあります。ブラウザの DevTools → Application → Cookies で `localhost:5173` の Cookie を削除してから再ログインしてください。
- **401 Unauthorized**: `.env` の `TRAINER_APP_PASSWORD` とフロントで入力したパスワードが一致しているか確認。
- **`.env` を変えても反映されない**: `uvicorn --reload` は `.env` 変更を検知しません。Ctrl+C で停止して再起動してください。
- **フロントが `/api/*` で 502/504**: バックエンドが起動していないか、ポートが 8001 以外になっています。`vite.config.ts` の `proxy.target` とバックエンドのポートを合わせてください。

---

## 7. trade-live / trade-analyzer について

`apps/trade-live` と `apps/trade-analyzer` も同じ構造(`backend/` + `frontend/`)ですが、Phase 1 時点では未実装です。実装が進んだ時点でこのドキュメントに起動手順を追記します。
