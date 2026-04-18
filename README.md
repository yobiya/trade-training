# fx-trading

FXトレーニング・リアルトレードアプリのモノレポ。

詳細は [Specification.md](./Specification.md) 参照。

## 構成

```
.
├── packages/
│   ├── shared-schema/    # DB スキーマ定義・マイグレーション
│   └── market-data/      # 市場データ取得ライブラリ
├── apps/
│   ├── trade-trainer/    # アプリB: トレーニング
│   ├── trade-live/       # アプリC: リアルトレード
│   └── trade-analyzer/   # アプリD: 集計・AI分析
└── libs/
    └── common-ui-lib/    # 共通UIコンポーネント
```

## セットアップ

### 前提

- Python 3.13(`.python-version` で管理)
- Node.js 24(`.nvmrc` で管理)
- uv 0.11 以上
- npm 11 以上

### 初回セットアップ

```bash
# Python 側(全アプリのワークスペース環境構築)
uv sync

# フロントエンド側
npm install
```

### アプリ起動(開発)

```bash
# バックエンド(例: trade-trainer)
cd apps/trade-trainer/backend && uv run uvicorn trade_trainer_backend.main:app --reload

# フロントエンド(例: trade-trainer)
npm run dev --workspace=apps/trade-trainer/frontend
```
