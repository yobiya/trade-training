"""MT5 データソースプロバイダ(Windows 専用)。"""
import sys
from datetime import datetime, timezone

import pandas as pd

from market_data.providers.base import DataSourceProvider

if sys.platform != "win32":
    raise ImportError("MT5Provider は Windows 専用です。開発環境ではキャッシュ参照モードで起動してください。")

try:
    import MetaTrader5 as mt5
except ImportError as e:
    raise ImportError("MetaTrader5 パッケージが見つかりません: uv sync でインストールしてください。") from e

# MT5 の銘柄名には接尾辞が付く場合がある(例: "USDJPY.a")
# get_available_symbols() で補完する
_SYMBOL_SUFFIX_CACHE: dict[str, str] = {}


def _resolve_symbol(name: str) -> str:
    """接尾辞なし銘柄名から MT5 上の実際の銘柄名に解決する。キャッシュ付き。"""
    if name in _SYMBOL_SUFFIX_CACHE:
        return _SYMBOL_SUFFIX_CACHE[name]

    # 完全一致を試みる
    info = mt5.symbol_info(name)
    if info is not None:
        _SYMBOL_SUFFIX_CACHE[name] = name
        return name

    # 接尾辞付きで探す
    all_symbols = mt5.symbols_get()
    if all_symbols:
        for sym in all_symbols:
            if sym.name.startswith(name):
                _SYMBOL_SUFFIX_CACHE[name] = sym.name
                return sym.name

    # フォールバック: そのまま使う
    return name


def _rates_to_df(rates: object) -> pd.DataFrame:
    """MT5 から返される numpy structured array を DataFrame に変換する。"""
    if rates is None or len(rates) == 0:  # type: ignore[arg-type]
        return pd.DataFrame()

    df = pd.DataFrame(rates)  # type: ignore[call-overload]
    df["timestamp"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("timestamp")
    df = df.rename(columns={"tick_volume": "volume"})
    return df[["open", "high", "low", "close", "volume"]].astype(
        {"open": float, "high": float, "low": float, "close": float, "volume": int}
    )


class MT5Provider(DataSourceProvider):
    """MetaTrader5 Python API を使った価格データプロバイダ。"""

    SOURCE_NAME = "mt5"

    def initialize(self) -> bool:
        if not mt5.initialize():
            return False
        return True

    def shutdown(self) -> None:
        mt5.shutdown()

    def is_connected(self) -> bool:
        info = mt5.terminal_info()
        return info is not None and info.connected

    def fetch_ohlc_m5(self, symbol: str, from_dt: datetime, to_dt: datetime) -> pd.DataFrame:
        resolved = _resolve_symbol(symbol)
        # MT5 は UTC naive の datetime を期待する
        from_naive = from_dt.replace(tzinfo=None) if from_dt.tzinfo else from_dt
        to_naive = to_dt.replace(tzinfo=None) if to_dt.tzinfo else to_dt

        rates = mt5.copy_rates_range(resolved, mt5.TIMEFRAME_M5, from_naive, to_naive)
        df = _rates_to_df(rates)
        if not df.empty:
            df.index.name = "timestamp"
        return df

    def fetch_latest_m5(self, symbol: str, n_bars: int) -> pd.DataFrame:
        resolved = _resolve_symbol(symbol)
        rates = mt5.copy_rates_from_pos(resolved, mt5.TIMEFRAME_M5, 0, n_bars)
        return _rates_to_df(rates)

    def get_symbol_digits(self, symbol: str) -> int | None:
        resolved = _resolve_symbol(symbol)
        info = mt5.symbol_info(resolved)
        if info is None:
            return None
        return int(info.digits)

    def get_available_range(self, symbol: str) -> tuple[datetime, datetime] | None:
        resolved = _resolve_symbol(symbol)
        # 全期間の最初と最後の1本を取得して範囲を推定する
        oldest = mt5.copy_rates_from_pos(resolved, mt5.TIMEFRAME_M5, 0, 1)
        if oldest is None or len(oldest) == 0:
            return None
        latest = mt5.copy_rates_from_pos(resolved, mt5.TIMEFRAME_M5, 0, 1)
        if latest is None or len(latest) == 0:
            return None

        # 全期間を取るために十分大きな件数で取得して min/max を返す
        all_rates = mt5.copy_rates_from_pos(resolved, mt5.TIMEFRAME_M5, 0, 2_000_000)
        if all_rates is None or len(all_rates) == 0:
            return None

        from_ts = datetime.fromtimestamp(int(all_rates[0]["time"]), tz=timezone.utc)
        to_ts = datetime.fromtimestamp(int(all_rates[-1]["time"]), tz=timezone.utc)
        return from_ts, to_ts
