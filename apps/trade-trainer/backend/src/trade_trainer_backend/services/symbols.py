"""銘柄メタ情報(pip サイズ導出)。仕様書 §3.1 単一情報源。

通常パスは MT5 `symbol_info.point` を起点に `derive_pip_size()` で導出する。MT5 接続失敗時は
`pip_size_fallback()` で `config/symbols.toml` のフォールバック値を使う。

銘柄ごとの設定値(category / pip_size_fallback / aliases)は **`config/symbols.toml`** に
集約され、本ファイルは load 済みの `SymbolsConfig` を参照する(コードに table を持たない)。
frontend は `SessionResponse.pip_size` を読むだけでハードコード table を持たない。
"""
from shared_schema.symbols_config import SymbolCategory, get_symbols_config


def _category_of(symbol: str) -> SymbolCategory:
    cfg = get_symbols_config()
    sd = cfg.by_code.get(symbol.upper())
    return sd.category if sd is not None else "fx"


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

    `config/symbols.toml` の `pip_size_fallback` 値を返す。未登録銘柄は JPY=0.01 / 他=0.0001
    の最終フォールバック(broker 一般慣行)。通常パスは `derive_pip_size` を使う。
    """
    sym = symbol.upper()
    cfg = get_symbols_config()
    sd = cfg.by_code.get(sym)
    if sd is not None:
        return sd.pip_size_fallback
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
