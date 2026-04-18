"""時間軸定数とリサンプリングユーティリティ。"""
from datetime import timedelta

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
}

BASE_TIMEFRAME = "M5"
SUPPORTED_TIMEFRAMES = list(TIMEFRAME_MINUTES.keys())


def resample_ohlc(df: pd.DataFrame, target_tf: str) -> pd.DataFrame:
    """M5 DataFrame を上位足にリサンプリングして返す。"""
    if target_tf not in _RESAMPLE_RULE:
        raise ValueError(f"Unsupported timeframe: {target_tf}. Use one of {SUPPORTED_TIMEFRAMES}")
    if target_tf == BASE_TIMEFRAME:
        return df
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
