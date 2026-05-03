"""market_data.timeframes: bar_start / resample_ohlc 単体テスト。"""
from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from market_data.timeframes import bar_start, resample_ohlc

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)


def make_ohlcv(timestamps: list[str], opens: list[float] | None = None) -> pd.DataFrame:
    """UTC-aware OHLCV DataFrame を生成する。OHLC は open の値に基づいて単純に設定。"""
    idx = pd.DatetimeIndex([pd.Timestamp(t, tz="UTC") for t in timestamps])
    n = len(timestamps)
    o = opens if opens is not None else [1.1000 + i * 0.0001 for i in range(n)]
    return pd.DataFrame(
        {
            "open": o,
            "high": [v + 0.0010 for v in o],
            "low": [v - 0.0010 for v in o],
            "close": [v + 0.0005 for v in o],
            "volume": [100] * n,
        },
        index=idx,
    )


# ---------------------------------------------------------------------------
# bar_start: 分足系 TF
# ---------------------------------------------------------------------------

class TestBarStartMinuteTfs:
    def test_m5_floor_to_5min_boundary(self) -> None:
        assert bar_start(utc(2024, 1, 15, 10, 32), "M5") == utc(2024, 1, 15, 10, 30)

    def test_m5_exact_boundary_unchanged(self) -> None:
        assert bar_start(utc(2024, 1, 15, 10, 30), "M5") == utc(2024, 1, 15, 10, 30)

    def test_m5_just_before_boundary_stays_in_prev(self) -> None:
        # 10:04:59 → bar start は 10:00
        assert bar_start(utc(2024, 1, 15, 10, 4, 59), "M5") == utc(2024, 1, 15, 10, 0)

    def test_m15_floor(self) -> None:
        assert bar_start(utc(2024, 1, 15, 10, 22), "M15") == utc(2024, 1, 15, 10, 15)

    def test_h1_floor(self) -> None:
        assert bar_start(utc(2024, 1, 15, 10, 32), "H1") == utc(2024, 1, 15, 10, 0)

    def test_h1_exact_boundary(self) -> None:
        assert bar_start(utc(2024, 1, 15, 11, 0), "H1") == utc(2024, 1, 15, 11, 0)

    def test_h4_boundary_from_utc_epoch(self) -> None:
        # H4 バーは UTC 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 に開始
        assert bar_start(utc(2024, 1, 15, 10, 0), "H4") == utc(2024, 1, 15, 8, 0)
        assert bar_start(utc(2024, 1, 15, 8, 0), "H4") == utc(2024, 1, 15, 8, 0)
        assert bar_start(utc(2024, 1, 15, 11, 59), "H4") == utc(2024, 1, 15, 8, 0)
        assert bar_start(utc(2024, 1, 15, 12, 0), "H4") == utc(2024, 1, 15, 12, 0)

    def test_m1_floor(self) -> None:
        assert bar_start(utc(2024, 1, 15, 10, 32, 45), "M1") == utc(2024, 1, 15, 10, 32)


# ---------------------------------------------------------------------------
# bar_start: D1 / W1 / MN1
# ---------------------------------------------------------------------------

class TestBarStartCalendarTfs:
    def test_d1_floor_to_midnight(self) -> None:
        assert bar_start(utc(2024, 1, 15, 10, 32), "D1") == utc(2024, 1, 15)

    def test_d1_exact_midnight_unchanged(self) -> None:
        assert bar_start(utc(2024, 1, 15, 0, 0), "D1") == utc(2024, 1, 15)

    def test_w1_monday_start(self) -> None:
        # 2024-01-15 は月曜日
        assert bar_start(utc(2024, 1, 15, 10, 0), "W1") == utc(2024, 1, 15)

    def test_w1_mid_week_returns_monday(self) -> None:
        # 2024-01-17 は水曜日 → 月曜 2024-01-15
        assert bar_start(utc(2024, 1, 17, 10, 0), "W1") == utc(2024, 1, 15)

    def test_w1_weekend_returns_prev_monday(self) -> None:
        # 2024-01-20 は土曜日 → 月曜 2024-01-15
        assert bar_start(utc(2024, 1, 20, 15, 0), "W1") == utc(2024, 1, 15)

    def test_w1_sunday_returns_prev_monday(self) -> None:
        # 2024-01-21 は日曜日 → 月曜 2024-01-15
        assert bar_start(utc(2024, 1, 21, 8, 0), "W1") == utc(2024, 1, 15)

    def test_mn1_returns_first_of_month(self) -> None:
        assert bar_start(utc(2024, 1, 15, 10, 32), "MN1") == utc(2024, 1, 1)

    def test_mn1_first_day_unchanged(self) -> None:
        assert bar_start(utc(2024, 2, 1, 0, 0), "MN1") == utc(2024, 2, 1)

    def test_mn1_last_day_of_month(self) -> None:
        assert bar_start(utc(2024, 1, 31, 23, 59), "MN1") == utc(2024, 1, 1)


# ---------------------------------------------------------------------------
# bar_start: naive datetime → UTC として扱う(DST の影響なし)
# ---------------------------------------------------------------------------

class TestBarStartNaiveDatetime:
    def test_naive_treated_as_utc(self) -> None:
        naive = datetime(2024, 1, 15, 10, 32)
        assert bar_start(naive, "M5") == utc(2024, 1, 15, 10, 30)

    def test_naive_d1_midnight(self) -> None:
        naive = datetime(2024, 3, 31, 1, 30)  # DST 移行日 → UTC 扱いなので影響なし
        assert bar_start(naive, "D1") == utc(2024, 3, 31)

    def test_result_is_always_utc_aware(self) -> None:
        result = bar_start(datetime(2024, 1, 15, 10, 32), "H1")
        assert result.tzinfo is not None
        assert result.tzinfo == timezone.utc


# ---------------------------------------------------------------------------
# resample_ohlc: 空 / 不正 TF
# ---------------------------------------------------------------------------

class TestResampleOhlcEdgeCases:
    def test_empty_df_returns_empty(self) -> None:
        empty = pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        result = resample_ohlc(empty, "H1")
        assert result.empty

    def test_unsupported_tf_raises_value_error(self) -> None:
        df = make_ohlcv(["2024-01-15 10:00"])
        with pytest.raises(ValueError, match="Unsupported timeframe"):
            resample_ohlc(df, "INVALID")


# ---------------------------------------------------------------------------
# resample_ohlc: OHLCV 集約規約(§C.4)
# ---------------------------------------------------------------------------

class TestResampleOhlcAggregation:
    def test_m5_to_h1_ohlcv_values(self) -> None:
        """open=first / high=max / low=min / close=last / volume=sum の確認。"""
        timestamps = [f"2024-01-15 10:{m:02d}" for m in range(0, 60, 5)]  # 10:00 〜 10:55
        opens = [1.1000, 1.1010, 1.0990, 1.1005, 1.1015, 1.1008,
                 1.1002, 1.1020, 1.0995, 1.1012, 1.1018, 1.1025]
        df = make_ohlcv(timestamps, opens)

        result = resample_ohlc(df, "H1")
        assert len(result) == 1

        row = result.iloc[0]
        assert row["open"] == pytest.approx(opens[0])              # first
        assert row["high"] == pytest.approx(max(o + 0.001 for o in opens))  # max(high)
        assert row["low"] == pytest.approx(min(o - 0.001 for o in opens))   # min(low)
        assert row["close"] == pytest.approx(opens[-1] + 0.0005)  # last(close)
        assert row["volume"] == 100 * 12                            # sum

    def test_label_is_bar_start(self) -> None:
        """label='left': H1 バーのインデックスが 10:00(開始時刻)"""
        df = make_ohlcv(["2024-01-15 10:00", "2024-01-15 10:30"])
        result = resample_ohlc(df, "H1")
        assert result.index[0] == pd.Timestamp("2024-01-15 10:00", tz="UTC")

    def test_closed_left_boundary(self) -> None:
        """closed='left': 10:55 は [10:00, 11:00) に含まれ、11:00 は次バーの先頭。"""
        df = make_ohlcv([
            "2024-01-15 10:55",  # → H1 10:00 バケット
            "2024-01-15 11:00",  # → H1 11:00 バケット
        ])
        result = resample_ohlc(df, "H1")
        assert len(result) == 2
        assert result.index[0] == pd.Timestamp("2024-01-15 10:00", tz="UTC")
        assert result.index[1] == pd.Timestamp("2024-01-15 11:00", tz="UTC")

    def test_output_index_is_utc_aware(self) -> None:
        """出力 index が UTC-aware であること。"""
        df = make_ohlcv(["2024-01-15 10:00", "2024-01-15 10:05"])
        result = resample_ohlc(df, "H1")
        assert result.index.tzinfo is not None

    def test_src_tf_agnostic_m15_to_h1(self) -> None:
        """src が M15 でも H1 に集約できる(M5 限定の前提を持たない)。"""
        timestamps = [f"2024-01-15 {h:02d}:{m:02d}" for h in [10, 10, 10, 10] for m in [0, 15, 30, 45]]
        df = make_ohlcv(timestamps[:4])
        result = resample_ohlc(df, "H1")
        assert len(result) == 1

    def test_multiple_h1_bars_from_m5(self) -> None:
        """複数 H1 バーが正しく分割される。"""
        t1 = [f"2024-01-15 10:{m:02d}" for m in range(0, 60, 5)]
        t2 = [f"2024-01-15 11:{m:02d}" for m in range(0, 60, 5)]
        df = make_ohlcv(t1 + t2)
        result = resample_ohlc(df, "H1")
        assert len(result) == 2
        assert result.index[0] == pd.Timestamp("2024-01-15 10:00", tz="UTC")
        assert result.index[1] == pd.Timestamp("2024-01-15 11:00", tz="UTC")

    def test_single_bar_passes_through(self) -> None:
        """1 本だけの入力でも集約後に 1 本出力される。"""
        df = make_ohlcv(["2024-01-15 10:00"])
        result = resample_ohlc(df, "H1")
        assert len(result) == 1

    def test_d1_aggregation(self) -> None:
        """D1 集約: H4 3 本 → D1 1 本。"""
        timestamps = ["2024-01-15 00:00", "2024-01-15 04:00", "2024-01-15 08:00"]
        opens = [1.10, 1.11, 1.12]
        df = make_ohlcv(timestamps, opens)
        result = resample_ohlc(df, "D1")
        assert len(result) == 1
        assert result.iloc[0]["open"] == pytest.approx(1.10)   # first
        assert result.iloc[0]["close"] == pytest.approx(1.12 + 0.0005)  # last
        assert result.iloc[0]["volume"] == 300
