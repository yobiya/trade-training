"""chart.py プライベートヘルパ(_bar_start_for_tf / _calculate_pips / _check_sl_tp)の単体テスト。"""
from dataclasses import dataclass
from datetime import datetime, timezone

import pandas as pd
import pytest

from trade_trainer_backend.routers.chart import _bar_start_for_tf, _calculate_pips, _check_sl_tp

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def utc(year: int, month: int, day: int, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# _bar_start_for_tf
# (timeframes.bar_start と実装が同一。router 内でも正しく動作することを確認する)
# ---------------------------------------------------------------------------

class TestBarStartForTf:
    def test_m5_floor(self) -> None:
        assert _bar_start_for_tf(utc(2024, 1, 15, 10, 32), "M5") == utc(2024, 1, 15, 10, 30)

    def test_h1_floor(self) -> None:
        assert _bar_start_for_tf(utc(2024, 1, 15, 10, 32), "H1") == utc(2024, 1, 15, 10, 0)

    def test_h4_boundary(self) -> None:
        # H4 バーは 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC
        assert _bar_start_for_tf(utc(2024, 1, 15, 10, 0), "H4") == utc(2024, 1, 15, 8, 0)

    def test_d1_midnight(self) -> None:
        assert _bar_start_for_tf(utc(2024, 1, 15, 10, 32), "D1") == utc(2024, 1, 15)

    def test_w1_mid_week_returns_monday(self) -> None:
        # 2024-01-17 は水曜日 → 月曜 2024-01-15
        assert _bar_start_for_tf(utc(2024, 1, 17, 10, 0), "W1") == utc(2024, 1, 15)

    def test_w1_weekend_returns_monday(self) -> None:
        # 2024-01-20 は土曜日 → 月曜 2024-01-15
        assert _bar_start_for_tf(utc(2024, 1, 20, 15, 0), "W1") == utc(2024, 1, 15)

    def test_mn1_first_of_month(self) -> None:
        assert _bar_start_for_tf(utc(2024, 1, 15, 10, 32), "MN1") == utc(2024, 1, 1)

    def test_naive_datetime_treated_as_utc(self) -> None:
        naive = datetime(2024, 1, 15, 10, 32)
        assert _bar_start_for_tf(naive, "M5") == utc(2024, 1, 15, 10, 30)

    def test_result_is_utc_aware(self) -> None:
        result = _bar_start_for_tf(datetime(2024, 1, 15, 10, 32), "H1")
        assert result.tzinfo is not None
        assert result.tzinfo == timezone.utc


# ---------------------------------------------------------------------------
# _calculate_pips
# ---------------------------------------------------------------------------

class TestCalculatePips:
    # --- JPY ペア(pip_size = 0.01) ---

    def test_jpy_buy_profit(self) -> None:
        # (151.0 - 150.0) / 0.01 = 100.0 pips
        assert _calculate_pips("USDJPY", "buy", 150.0, 151.0) == pytest.approx(100.0)

    def test_jpy_buy_loss(self) -> None:
        # (149.5 - 150.0) / 0.01 = -50.0 pips
        assert _calculate_pips("USDJPY", "buy", 150.0, 149.5) == pytest.approx(-50.0)

    def test_jpy_sell_profit(self) -> None:
        # (150.0 - 149.0) / 0.01 = 100.0 pips
        assert _calculate_pips("USDJPY", "sell", 150.0, 149.0) == pytest.approx(100.0)

    def test_jpy_sell_loss(self) -> None:
        # (200.0 - 200.5) / 0.01 = -50.0 pips
        assert _calculate_pips("GBPJPY", "sell", 200.0, 200.5) == pytest.approx(-50.0)

    def test_jpy_symbol_case_insensitive(self) -> None:
        # 小文字 "usdjpy" でも JPY ペアと認識する
        assert _calculate_pips("usdjpy", "buy", 150.0, 151.0) == pytest.approx(100.0)

    def test_jpy_pair_with_mixed_case(self) -> None:
        assert _calculate_pips("GbpJpy", "buy", 190.0, 190.5) == pytest.approx(50.0)

    # --- 通常ペア(pip_size = 0.0001) ---

    def test_non_jpy_buy_profit(self) -> None:
        # (1.1010 - 1.1000) / 0.0001 = 10.0 pips
        assert _calculate_pips("EURUSD", "buy", 1.1000, 1.1010) == pytest.approx(10.0)

    def test_non_jpy_buy_loss(self) -> None:
        # (1.0990 - 1.1000) / 0.0001 = -10.0 pips
        assert _calculate_pips("EURUSD", "buy", 1.1000, 1.0990) == pytest.approx(-10.0)

    def test_non_jpy_sell_profit(self) -> None:
        # (1.2500 - 1.2490) / 0.0001 = 10.0 pips
        assert _calculate_pips("GBPUSD", "sell", 1.2500, 1.2490) == pytest.approx(10.0)

    def test_non_jpy_sell_loss(self) -> None:
        # (1.2500 - 1.2510) / 0.0001 = -10.0 pips
        assert _calculate_pips("GBPUSD", "sell", 1.2500, 1.2510) == pytest.approx(-10.0)

    # --- ゼロ pips ---

    def test_zero_pips_jpy(self) -> None:
        assert _calculate_pips("USDJPY", "buy", 150.0, 150.0) == pytest.approx(0.0)

    def test_zero_pips_non_jpy(self) -> None:
        assert _calculate_pips("EURUSD", "sell", 1.1000, 1.1000) == pytest.approx(0.0)

    # --- 戻り値が round(..., 1) されていること ---

    def test_result_is_rounded_to_1dp(self) -> None:
        # (151.234 - 150.0) / 0.01 = 123.4 (整数ではないが 1 桁) → 123.4
        result = _calculate_pips("USDJPY", "buy", 150.0, 151.234)
        assert result == pytest.approx(123.4)

    def test_result_rounded_not_truncated(self) -> None:
        # (150.005 - 150.0) / 0.01 = 0.5 → 0.5
        result = _calculate_pips("USDJPY", "buy", 150.0, 150.005)
        assert result == pytest.approx(0.5)

    # --- 商品銘柄(仕様書 §3.1 pip サイズ table)---

    def test_xauusd_buy_profit(self) -> None:
        # XAUUSD pip = 0.1 → ($1.0 動き = 10 pips)
        assert _calculate_pips("XAUUSD", "buy", 2000.0, 2001.0) == pytest.approx(10.0)

    def test_btcusd_sell_profit(self) -> None:
        # BTCUSD pip = 1.0 → ($50 動き = 50 pips)
        assert _calculate_pips("BTCUSD", "sell", 30000.0, 29950.0) == pytest.approx(50.0)

    def test_jp225_buy_loss(self) -> None:
        # JP225 pip = 1.0 → (40 円下落 = -40 pips for buy)
        assert _calculate_pips("JP225", "buy", 38000.0, 37960.0) == pytest.approx(-40.0)


# ---------------------------------------------------------------------------
# _check_sl_tp
# (advance 中の M5 解像度 SL/TP ヒット検出。hit_time = ヒット M5 バーの close 時刻)
# ---------------------------------------------------------------------------

@dataclass
class _StubTrade:
    direction: str
    sl: float | None = None
    tp: float | None = None


def _bars(*rows: tuple[datetime, float, float]) -> pd.DataFrame:
    """ts → (high, low) のタプル列から DataFrame を生成する。"""
    idx = [ts for ts, _, _ in rows]
    data = {"high": [h for _, h, _ in rows], "low": [l for _, _, l in rows]}
    return pd.DataFrame(data, index=pd.DatetimeIndex(idx, tz="UTC"))


class TestCheckSlTp:
    def test_no_bars_returns_none(self) -> None:
        empty = pd.DataFrame({"high": [], "low": []}, index=pd.DatetimeIndex([], tz="UTC"))
        assert _check_sl_tp(_StubTrade("buy", sl=149.0, tp=151.0), empty) is None

    def test_no_hit_in_range(self) -> None:
        bars = _bars(
            (utc(2024, 1, 15, 10, 0), 150.5, 149.5),
            (utc(2024, 1, 15, 10, 5), 150.6, 149.7),
        )
        assert _check_sl_tp(_StubTrade("buy", sl=149.0, tp=151.0), bars) is None

    def test_buy_tp_hit_returns_first_bar_close_time(self) -> None:
        # 2 本目の M5 バー(open=10:05)で high=151.2 → tp=151.0 をヒット。
        # hit_time は **その bar の close = 10:10**(open + 5min)。
        bars = _bars(
            (utc(2024, 1, 15, 10, 0), 150.5, 149.5),  # not hit
            (utc(2024, 1, 15, 10, 5), 151.2, 150.0),  # tp hit (high >= 151.0)
            (utc(2024, 1, 15, 10, 10), 152.0, 151.0),
        )
        result = _check_sl_tp(_StubTrade("buy", sl=149.0, tp=151.0), bars)
        assert result == ("tp", 151.0, utc(2024, 1, 15, 10, 10))

    def test_buy_sl_hit_returns_first_bar_close_time(self) -> None:
        bars = _bars(
            (utc(2024, 1, 15, 10, 0), 150.5, 149.8),
            (utc(2024, 1, 15, 10, 5), 150.0, 148.5),  # sl hit (low <= 149.0)
        )
        result = _check_sl_tp(_StubTrade("buy", sl=149.0, tp=151.0), bars)
        assert result == ("sl", 149.0, utc(2024, 1, 15, 10, 10))

    def test_sell_sl_hit(self) -> None:
        # sell の SL: high >= sl
        bars = _bars(
            (utc(2024, 1, 15, 10, 0), 150.0, 149.5),
            (utc(2024, 1, 15, 10, 5), 151.5, 150.5),  # sl hit (high >= 151.0)
        )
        result = _check_sl_tp(_StubTrade("sell", sl=151.0, tp=149.0), bars)
        assert result == ("sl", 151.0, utc(2024, 1, 15, 10, 10))

    def test_sell_tp_hit(self) -> None:
        # sell の TP: low <= tp
        bars = _bars(
            (utc(2024, 1, 15, 10, 0), 150.0, 149.5),
            (utc(2024, 1, 15, 10, 5), 149.5, 148.5),  # tp hit (low <= 149.0)
        )
        result = _check_sl_tp(_StubTrade("sell", sl=151.0, tp=149.0), bars)
        assert result == ("tp", 149.0, utc(2024, 1, 15, 10, 10))

    def test_first_hit_wins_when_multiple_bars_qualify(self) -> None:
        # 2 本目で TP、3 本目で SL → 最初に来た TP を返す(advance は早期決済優先で停止)
        bars = _bars(
            (utc(2024, 1, 15, 10, 0), 150.5, 149.5),  # not hit
            (utc(2024, 1, 15, 10, 5), 151.5, 150.0),  # tp hit
            (utc(2024, 1, 15, 10, 10), 151.0, 148.0), # sl hit (but later)
        )
        result = _check_sl_tp(_StubTrade("buy", sl=149.0, tp=151.0), bars)
        assert result == ("tp", 151.0, utc(2024, 1, 15, 10, 10))

    def test_naive_index_is_treated_as_utc(self) -> None:
        # bars の index が naive でも hit_time は UTC aware で返される(I-1 整合)
        idx = pd.DatetimeIndex([datetime(2024, 1, 15, 10, 5)])
        df = pd.DataFrame({"high": [151.2], "low": [150.0]}, index=idx)
        result = _check_sl_tp(_StubTrade("buy", tp=151.0), df)
        assert result is not None
        assert result[2] == utc(2024, 1, 15, 10, 10)
        assert result[2].tzinfo == timezone.utc

    def test_only_sl_set_no_tp(self) -> None:
        bars = _bars((utc(2024, 1, 15, 10, 0), 150.0, 148.5))
        result = _check_sl_tp(_StubTrade("buy", sl=149.0, tp=None), bars)
        assert result == ("sl", 149.0, utc(2024, 1, 15, 10, 5))

    def test_only_tp_set_no_sl(self) -> None:
        bars = _bars((utc(2024, 1, 15, 10, 0), 151.5, 149.5))
        result = _check_sl_tp(_StubTrade("buy", sl=None, tp=151.0), bars)
        assert result == ("tp", 151.0, utc(2024, 1, 15, 10, 5))
