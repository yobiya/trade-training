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
│   └── trade-live/       # アプリC: リアルトレード
└── libs/
    └── common-ui-lib/    # 共通UIコンポーネント
```

## セットアップと起動

セットアップ手順・環境変数・設定ファイル・トラブルシュートは [docs/Setup.md](./docs/Setup.md) を参照してください。

最小手順:

```bash
uv sync
npm install
```

起動(trade-trainer、ターミナル 2 枚):

```bash
# backend
cd apps/trade-trainer/backend && uv run uvicorn trade_trainer_backend.main:app --reload --port 8001

# frontend
npm run dev --workspace=apps/trade-trainer/frontend
```
