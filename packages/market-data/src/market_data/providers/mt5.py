"""MT5 データソースプロバイダ(Windows 専用)。"""
import logging
import sys
from datetime import datetime, timedelta, timezone

import pandas as pd

from market_data.providers.base import DataSourceProvider

log = logging.getLogger(__name__)

if sys.platform != "win32":
    raise ImportError("MT5Provider は Windows 専用です。開発環境ではキャッシュ参照モードで起動してください。")

try:
    import MetaTrader5 as mt5
except ImportError as e:
    raise ImportError("MetaTrader5 パッケージが見つかりません: uv sync でインストールしてください。") from e

# MT5 の銘柄名には接尾辞が付く場合がある(例: "USDJPY.a")
# get_available_symbols() で補完する
_SYMBOL_SUFFIX_CACHE: dict[str, str] = {}

# 仕様 §5.1.1 / 設計 §B I-2(ver 1.58): 各 TF を MT5 から個別取得する
_MT5_TIMEFRAME = {
    "M1": mt5.TIMEFRAME_M1,
    "M5": mt5.TIMEFRAME_M5,
    "M15": mt5.TIMEFRAME_M15,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H4": mt5.TIMEFRAME_H4,
    "D1": mt5.TIMEFRAME_D1,
    "W1": mt5.TIMEFRAME_W1,
    "MN1": mt5.TIMEFRAME_MN1,
}


def _resolve_symbol(name: str) -> str:
    """接尾辞なし銘柄名から MT5 上の実際の銘柄名に解決する。キャッシュ付き。

    解決後は `mt5.symbol_select(resolved, True)` で MarketWatch に追加する。
    MT5 は MarketWatch 未登録の銘柄に対して `copy_rates_range` が silent に空配列を
    返す仕様のため、ここで明示的に登録しないと「データが取れず原因が分からない」
    というデバッグ困難な状態になる。
    """
    if name in _SYMBOL_SUFFIX_CACHE:
        return _SYMBOL_SUFFIX_CACHE[name]

    # 完全一致を試みる
    resolved: str | None = None
    info = mt5.symbol_info(name)
    if info is not None:
        resolved = name
    else:
        # 接尾辞付きで探す
        all_symbols = mt5.symbols_get()
        if all_symbols:
            for sym in all_symbols:
                if sym.name.startswith(name):
                    resolved = sym.name
                    break

    if resolved is None:
        log.warning(
            "[mt5] symbol %s not found via symbol_info or symbols_get. "
            "broker に該当銘柄が無いか、銘柄名のサフィックスが想定外です。",
            name,
        )
        # キャッシュしない(後続で broker が銘柄を追加した場合に再解決可能にする)
        return name

    # MarketWatch に登録(copy_rates_range が空配列を返す問題の対策)
    if not mt5.symbol_select(resolved, True):
        log.warning(
            "[mt5] symbol_select failed for %s; copy_rates_range may return empty. "
            "MT5 のマーケットウォッチに当該銘柄を手動で追加してください。",
            resolved,
        )

    _SYMBOL_SUFFIX_CACHE[name] = resolved
    return resolved


def _rates_to_df(rates: object) -> pd.DataFrame:
    """MT5 から返される numpy structured array を DataFrame に変換する。

    broker によっては境界バーが重複して返るケースがあるため、timestamp 重複を除去 + 昇順ソートして返す
    (lightweight-charts の strictly ascending 要件に整合)。
    """
    if rates is None or len(rates) == 0:  # type: ignore[arg-type]
        return pd.DataFrame()

    df = pd.DataFrame(rates)  # type: ignore[call-overload]
    df["timestamp"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("timestamp")
    df = df.rename(columns={"tick_volume": "volume"})
    df = df[["open", "high", "low", "close", "volume"]].astype(
        {"open": float, "high": float, "low": float, "close": float, "volume": int}
    )
    return df[~df.index.duplicated(keep="last")].sort_index()


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

    def fetch_ohlc(
        self, symbol: str, timeframe: str, from_dt: datetime, to_dt: datetime
    ) -> pd.DataFrame:
        if timeframe not in _MT5_TIMEFRAME:
            raise ValueError(f"Unsupported timeframe for MT5: {timeframe}")
        resolved = _resolve_symbol(symbol)
        # MT5 Python API: naive datetime はブローカーのサーバー時刻(JST 等)として解釈される。
        # tz-aware (UTC) を渡すとブローカー側で正しくサーバー時刻に変換される。
        # naive で来た場合は UTC として補完する(本コードベースは UTC 統一が前提)。
        from_aware = from_dt if from_dt.tzinfo else from_dt.replace(tzinfo=timezone.utc)
        to_aware = to_dt if to_dt.tzinfo else to_dt.replace(tzinfo=timezone.utc)

        rates = mt5.copy_rates_range(resolved, _MT5_TIMEFRAME[timeframe], from_aware, to_aware)
        df = _rates_to_df(rates)
        log.debug("mt5.fetch_ohlc sym=%s tf=%s from=%s to=%s rows=%d", symbol, timeframe, from_aware, to_aware, len(df))
        if df.empty:
            # MT5 エラーコードを取得して原因を絞り込む(MarketWatch 未登録 / 銘柄誤り / range 外 等)。
            err = mt5.last_error()
            log.warning(
                "[mt5] copy_rates_range returned empty sym=%s tf=%s resolved=%s range=[%s, %s] last_error=%s",
                symbol, timeframe, resolved, from_aware, to_aware, err,
            )
        if not df.empty:
            df.index.name = "timestamp"
            # サニティチェック: 戻り値の最初/最後が要求 range の ±2 バー以内であること。
            # broker サーバー時刻のズレや週末処理で多少前後することはあるが、大幅な逸脱は TZ 事故の徴候。
            from market_data.timeframes import timeframe_delta
            tolerance = max(timeframe_delta(timeframe) * 2, timedelta(hours=2))
            first_ts = df.index[0]
            last_ts = df.index[-1]
            if first_ts < from_aware - tolerance or last_ts > to_aware + tolerance:
                log.warning(
                    "[mt5] response timestamps out of expected range sym=%s tf=%s req=[%s, %s] got=[%s, %s] (suspected TZ misalignment)",
                    symbol, timeframe, from_aware, to_aware, first_ts, last_ts,
                )
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
