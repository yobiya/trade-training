"""OHLC fetcher: キャッシュなし、provider 直叩きの薄いラッパ。

MT5 Python API はリクエスト処理がシリアライズされる特性があり、キャッシュ層 + 上位足の
再帰集約を挟むと cold load が遅延しやすい。これを避けるため、本モジュールは「provider に
問い合わせて DataFrame を返す」だけの薄いラッパに留める。

上位 TF の最新バー連鎖集約は backend `routers/chart.py:chart_stack` 側で行う(設計 §B I-2)。
"""
import logging
from datetime import datetime

import pandas as pd
from sqlalchemy.orm import Session

from market_data.providers.base import DataSourceProvider
from market_data.timeframes import TIMEFRAME_MINUTES

log = logging.getLogger(__name__)


def fetch_ohlc(
    session: Session,  # noqa: ARG001 - 互換のため残す(将来キャッシュ層を再導入する余地)
    symbol: str,
    timeframe: str,
    from_dt: datetime,
    to_dt: datetime,
    provider: DataSourceProvider | None = None,
    source: str = "mt5",  # noqa: ARG001
) -> pd.DataFrame:
    """指定 TF の OHLC を provider から直接取得して返す。

    キャッシュ層を経由しない。provider が接続されていない or 範囲外で
    空 DataFrame が返る場合もある(I-11.3 に準じて呼び出し側が空を許容する)。
    """
    if timeframe not in TIMEFRAME_MINUTES:
        raise ValueError(f"Unsupported timeframe: {timeframe}")
    if provider is None or not provider.is_connected():
        log.warning("[fetch_ohlc] provider not connected sym=%s tf=%s", symbol, timeframe)
        return pd.DataFrame()
    if from_dt >= to_dt:
        return pd.DataFrame()
    return provider.fetch_ohlc(symbol, timeframe, from_dt, to_dt)


# 後方互換: M5 ショートカット
def fetch_ohlc_m5(
    session: Session,
    symbol: str,
    from_dt: datetime,
    to_dt: datetime,
    provider: DataSourceProvider | None = None,
    source: str = "mt5",
) -> pd.DataFrame:
    return fetch_ohlc(session, symbol, "M5", from_dt, to_dt, provider, source)
