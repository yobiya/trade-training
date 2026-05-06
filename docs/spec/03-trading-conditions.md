# §3. 取引条件

← [仕様書インデックス](./README.md)

---

| 項目 | 扱い |
|---|---|
| スプレッド | 銘柄別固定値を **`config/symbols.toml`** の `[symbols.X].spread_pips` で管理([§2.8](./02-data-foundation.md#28-対象銘柄)) |
| スリッページ | なし |
| スワップ | なし |
| ロット・証拠金 | なし(pips損益ベースで評価) |

**スプレッド初期値の確定方針**
- MT5 デモ口座接続前は**暫定値**を `config/symbols.toml` の `spread_pips` に置く(一般的な値で運用)
- MT5 デモ口座の接続が通った時点で、実測値(平均スプレッド)に更新
- 設定画面からもユーザーが編集可能(Setting テーブル経由、将来実装)

## 3.1 銘柄別 pip サイズ

pip 損益を計算するため、銘柄ごとに **1 pip = 価格何単位** を定める。**真実の所有者は MT5**(`symbol_info.point` / `.digits`)で、backend がセッション作成時に取得して導出する([§2.4 正規化ルール](./02-data-foundation.md#24-データソース抽象化の設計))。カテゴリ判定とフォールバック値は `config/symbols.toml` から読み出す([§2.8](./02-data-foundation.md#28-対象銘柄))。

### 導出ルール

backend `services/symbols.py:derive_pip_size(point, digits, symbol)` に集約する。MT5 から取得した `point` を起点に、`config/symbols.toml` の `category` で補正する:

| カテゴリ | 例 | 導出ルール | 実効値の例 |
|---|---|---|---|
| `fx` | `USDJPY`, `EURUSD` | `pip = 10 × point` (5-digit / 3-digit JPY 共に成立) | JPY=0.01、その他=0.0001 |
| `metal` | `XAUUSD`, `XAGUSD` | `pip = 10 × point`(broker 慣行に一致) | XAU=0.1、XAG=0.01 |
| `crypto_btc` | `BTCUSD` | `pip = 100 × point`(broker 慣行: $1 = 1 pip) | 1.0 |
| `crypto_eth` | `ETHUSD` | `pip = 10 × point` | 0.1 |
| `index` | `US30`, `NAS100`, `JP225` | `pip = 1 × point`(1 ポイント = 1 pip) | 1.0 |

カテゴリの multiplier(10×, 100× 等)は **市場慣行のロジック**として backend code に残す。「どの銘柄が `metal` か / どんな broker alias を持つか」は **broker 環境の設定**として `config/symbols.toml` に置く。

### MT5 不通時のフォールバック

MT5 接続が確立していない / `symbol_info` が `None` を返すケースでは、`config/symbols.toml` の `pip_size_fallback` 値を使う(`services/symbols.py:pip_size_fallback(symbol)` 経由)。通常時は MT5 由来に自動的に切り替わる。

### 永続化と参照

- **frontend** (`SessionResponse.pip_size`): セッション取得 / 作成時に backend が乗せる。frontend は **読み取り専用** で受け取り、ハードコード table を持たない
- **`session.json` の `trade.pip_size`**: エントリー時に snapshot し、決済後の pips 計算もこの値で行う([§9.5](./09-post-review.md))。broker / シンボル設定が後から変わっても過去 trade は当時の pip で計算される(履歴改竄防止)
- pip 計算ロジックは backend / frontend の各呼び出し側で `endswith("JPY")` 等の判定を**しない**(必ず session.pip_size か trade.pip_size 経由)
