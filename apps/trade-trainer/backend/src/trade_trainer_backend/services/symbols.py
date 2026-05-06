"""銘柄メタ情報(pip サイズ導出)。仕様書 §3.1 単一情報源。

通常パスは MT5 `symbol_info.point` を起点に `derive_pip_size()` で導出する。MT5 接続失敗時は
`pip_size_fallback()` のハードコード table(broker 慣行ベース)を使う。

frontend は `SessionResponse.pip_size` を読むだけでハードコード table を持たない。
"""
from typing import Final, Literal

SymbolCategory = Literal["fx", "metal", "crypto_btc", "crypto_eth", "index"]

# 仕様書 §3.1: pip 導出ルール (FX = 10×point、商品はカテゴリ別)。broker 依存の揺れは
# `_CATEGORY_OVERRIDES` で吸収する。
_CATEGORY_OVERRIDES: Final[dict[str, SymbolCategory]] = {
    "XAUUSD": "metal",
    "XAGUSD": "metal",
    "BTCUSD": "crypto_btc",
    "ETHUSD": "crypto_eth",
    "US30": "index",
    "NAS100": "index",
    "JP225": "index",
}

# 仕様書 §3.1: MT5 不通時 / `symbol_info` 取得失敗時のハードコードフォールバック値
# (broker 一般慣行ベース)。通常パスでは到達しない。
_PIP_SIZE_FALLBACK: Final[dict[str, float]] = {
    "XAUUSD": 0.1,
    "XAGUSD": 0.01,
    "BTCUSD": 1.0,
    "ETHUSD": 0.1,
    "US30": 1.0,
    "NAS100": 1.0,
    "JP225": 1.0,
}


def _category_of(symbol: str) -> SymbolCategory:
    sym = symbol.upper()
    if sym in _CATEGORY_OVERRIDES:
        return _CATEGORY_OVERRIDES[sym]
    return "fx"  # 既定: FX 通貨ペア(USDJPY / EURUSD / ...)


def derive_pip_size(point: float, digits: int, symbol: str) -> float:
    """MT5 `symbol_info.point` / `digits` から pip サイズを導出する。仕様書 §3.1。

    Args:
        point: MT5 の価格最小単位(`symbol_info.point`)
        digits: 価格表示桁数(`symbol_info.digits`)
        symbol: 銘柄名(カテゴリ判定用)

    Returns:
        1 pip = ? の価格単位。
    """
    if point <= 0:
        # 異常値防御: フォールバックに切替
        return pip_size_fallback(symbol)

    category = _category_of(symbol)
    if category == "fx":
        # 5-digit / 3-digit broker の慣行: 1 pip = 10 × point。digits=4/2 broker ではすでに
        # point が pip と一致するが、現代の主要 MT5 broker は 5-digit/3-digit のため 10×point で統一。
        return 10.0 * point
    if category == "metal":
        return 10.0 * point  # XAUUSD point=0.01 → pip=0.1、XAGUSD point=0.001 → pip=0.01
    if category == "crypto_btc":
        return 100.0 * point  # BTC: $1 = 1 pip 慣行
    if category == "crypto_eth":
        return 10.0 * point  # ETH: $0.1 = 1 pip 慣行
    if category == "index":
        return float(point)  # 1 ポイント = 1 pip
    return float(point)


def pip_size_fallback(symbol: str) -> float:
    """MT5 不通時のフォールバック pip サイズ。仕様書 §3.1。

    通常パスは `derive_pip_size(point, digits, symbol)` を使う。本関数は
    MT5 接続が確立していない / `symbol_info` が `None` を返したケースの最終的な砦。
    """
    sym = symbol.upper()
    if sym in _PIP_SIZE_FALLBACK:
        return _PIP_SIZE_FALLBACK[sym]
    if sym.endswith("JPY"):
        return 0.01
    return 0.0001


def pip_size(symbol: str) -> float:
    """既存呼び出し互換。MT5 不通時のフォールバック値を返す(`pip_size_fallback` の別名)。

    新規コードは `derive_pip_size` を使い、その結果を session / trade に snapshot して
    後段に伝播させる方針(仕様書 §3.1)。本関数は MT5 接続が無い経路や、レガシーな
    symbol-only API のために残す。
    """
    return pip_size_fallback(symbol)
