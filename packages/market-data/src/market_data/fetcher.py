"""ハイブリッドキャッシュフェッチャー - キャッシュ確認 → 不足分を MT5 から取得(仕様書 1.5)。"""
from datetime import datetime, timedelta, timezone

import pandas as pd
from sqlalchemy.orm import Session

from market_data.cache import get_cached_extremes, get_cached_ohlc, store_ohlc
from market_data.providers.base import DataSourceProvider

_GAP_THRESHOLD = timedelta(minutes=10)  # この差以上ならギャップとみなして再取得する


def fetch_ohlc_m5(
    session: Session,
    symbol: str,
    from_dt: datetime,
    to_dt: datetime,
    provider: DataSourceProvider | None = None,
    source: str = "mt5",
) -> pd.DataFrame:
    """ハイブリッドキャッシュ方式で M5 OHLC を取得する。

    1. SQLite キャッシュを確認
    2. キャッシュが期間をカバーしていなければ provider から不足分を取得
    3. 取得したデータをキャッシュに保存して返す

    provider が None、または接続していない場合はキャッシュのみを返す。
    """
    # キャッシュの範囲を確認
    extremes = get_cached_extremes(session, symbol, source)

    needs_leading = True
    needs_trailing = True

    if extremes is not None:
        cached_oldest, cached_latest = extremes
        needs_leading = from_dt < (cached_oldest - _GAP_THRESHOLD)
        needs_trailing = to_dt > (cached_latest + _GAP_THRESHOLD)

    # プロバイダが利用可能な場合のみ不足分をフェッチ
    if provider is not None and provider.is_connected():
        if needs_leading and needs_trailing and extremes is None:
            # キャッシュが完全に空: 全範囲を取得
            fetched = provider.fetch_ohlc_m5(symbol, from_dt, to_dt)
            if not fetched.empty:
                store_ohlc(session, fetched, symbol, source)
        else:
            if needs_leading and extremes is not None:
                cached_oldest, _ = extremes
                leading = provider.fetch_ohlc_m5(symbol, from_dt, cached_oldest - timedelta(minutes=5))
                if not leading.empty:
                    store_ohlc(session, leading, symbol, source)

            if needs_trailing and extremes is not None:
                _, cached_latest = extremes
                trailing = provider.fetch_ohlc_m5(
                    symbol, cached_latest + timedelta(minutes=5), to_dt
                )
                if not trailing.empty:
                    store_ohlc(session, trailing, symbol, source)

    # キャッシュから読み直して返す
    return get_cached_ohlc(session, symbol, from_dt, to_dt, source)
