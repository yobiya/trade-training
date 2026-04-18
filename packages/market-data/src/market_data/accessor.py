"""アプリから呼ぶエントリーポイント(仕様書 1.5 market-data)。

使用例:
    from market_data.accessor import configure, get_ohlc
    from market_data.providers.mt5 import MT5Provider

    configure("trading.db", MT5Provider())
    df = get_ohlc("USDJPY", "H1", from_dt, to_dt)
"""
from datetime import datetime
from pathlib import Path

import pandas as pd

from market_data.fetcher import fetch_ohlc_m5
from market_data.providers.base import DataSourceProvider
from market_data.timeframes import resample_ohlc

_provider: DataSourceProvider | None = None
_initialized: bool = False


def configure(
    db_path: str | Path = "trading.db",
    provider: DataSourceProvider | None = None,
) -> None:
    """market-data を初期化する。アプリ起動時に1回呼ぶ。

    provider=None にするとキャッシュ参照モード(開発環境向け)。
    """
    global _provider, _initialized

    from shared_schema.database import init_db
    init_db(db_path)

    if provider is not None:
        provider.initialize()

    _provider = provider
    _initialized = True


def get_ohlc(
    symbol: str,
    timeframe: str,
    from_dt: datetime,
    to_dt: datetime,
) -> pd.DataFrame:
    """OHLC データを取得して返す。

    - キャッシュにあればそこから返す
    - なければ provider(MT5等)から取得してキャッシュに保存
    - timeframe が M5 以外なら M5 データをリサンプリングして返す
    """
    if not _initialized:
        raise RuntimeError("market_data が未初期化です。configure() を先に呼んでください。")

    from shared_schema.database import get_session
    with next(get_session()) as session:
        m5_df = fetch_ohlc_m5(session, symbol, from_dt, to_dt, _provider)

    return resample_ohlc(m5_df, timeframe)


def get_latest(symbol: str, timeframe: str, n_bars: int = 500) -> pd.DataFrame:
    """直近 n_bars 本を取得する。リアルトレードのチャート表示用。"""
    if not _initialized:
        raise RuntimeError("market_data が未初期化です。configure() を先に呼んでください。")

    if _provider is None or not _provider.is_connected():
        raise RuntimeError("リアルタイムデータの取得には provider の接続が必要です。")

    m5_bars = n_bars if timeframe == "M5" else n_bars * 10
    df = _provider.fetch_latest_m5(symbol, m5_bars)
    return resample_ohlc(df, timeframe)


def shutdown() -> None:
    """アプリ終了時に呼ぶ。プロバイダ接続を切断する。"""
    global _initialized
    if _provider is not None:
        _provider.shutdown()
    _initialized = False
