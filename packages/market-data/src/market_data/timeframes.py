"""時間軸定数・リサンプリング・進行中バー境界ヘルパ。"""
from datetime import datetime, timedelta, timezone

import pandas as pd

TIMEFRAME_MINUTES: dict[str, int] = {
    "M1": 1,
    "M5": 5,
    "M15": 15,
    "M30": 30,
    "H1": 60,
    "H4": 240,
    "D1": 1440,
    "W1": 10080,
    "MN1": 43200,  # 30 日近似(月足は実際には 28〜31 日変動。fetch 範囲計算用)
}

# pandas resample ルール
_RESAMPLE_RULE: dict[str, str] = {
    "M1": "1min",
    "M5": "5min",
    "M15": "15min",
    "M30": "30min",
    "H1": "1h",
    "H4": "4h",
    "D1": "1D",
    "W1": "1W",
    "MN1": "MS",  # Month Start anchor(各月初日にアグリゲート)
}

BASE_TIMEFRAME = "M5"
SUPPORTED_TIMEFRAMES = list(TIMEFRAME_MINUTES.keys())


def resample_ohlc(df: pd.DataFrame, target_tf: str) -> pd.DataFrame:
    """任意 src TF の DataFrame を target_tf に集約して返す。

    主用途: chart-stack エンドポイントで上位 TF の最新バーを「一つ下の TF」から集約する(設計 §C.3)。
    確定済みバーの集約には使用しない(各 TF は MT5 から個別取得する)。
    """
    if target_tf not in _RESAMPLE_RULE:
        raise ValueError(f"Unsupported timeframe: {target_tf}. Use one of {SUPPORTED_TIMEFRAMES}")
    if df.empty:
        return df

    rule = _RESAMPLE_RULE[target_tf]
    resampled = df.resample(rule, closed="left", label="left").agg(
        {
            "open": "first",
            "high": "max",
            "low": "min",
            "close": "last",
            "volume": "sum",
        }
    )
    return resampled.dropna(subset=["open"])


def timeframe_delta(tf: str) -> timedelta:
    return timedelta(minutes=TIMEFRAME_MINUTES[tf])


def bar_start(dt: datetime, tf: str) -> datetime:
    """tf の進行中バーの始点(in-progress bar start)を返す。常に UTC-aware。

    例: bar_start(2026-04-28 14:32:00 UTC, 'H1') → 2026-04-28 14:00:00 UTC
        bar_start(2026-04-28 14:32:00 UTC, 'D1') → 2026-04-28 00:00:00 UTC
        bar_start(2026-04-28 14:32:00 UTC, 'W1') → 2026-04-27 00:00:00 UTC (Mon, ISO 週)
        bar_start(2026-04-28 14:32:00 UTC, 'MN1') → 2026-04-01 00:00:00 UTC

    `resample_ohlc(closed='left', label='left')` の境界と整合する。
    """
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    if tf == "MN1":
        return datetime(aware.year, aware.month, 1, tzinfo=timezone.utc)
    if tf == "W1":
        # ISO 週: 月曜始まり 00:00:00 UTC
        days_since_mon = aware.weekday()
        day = aware.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_since_mon)
        return day
    if tf == "D1":
        return aware.replace(hour=0, minute=0, second=0, microsecond=0)
    # H4 / H1 / M30 / M15 / M5 / M1: 分単位の floor
    minutes = TIMEFRAME_MINUTES[tf]
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    delta_min = int((aware - epoch).total_seconds() // 60)
    floored_min = (delta_min // minutes) * minutes
    return epoch + timedelta(minutes=floored_min)
