"""chart.py プライベートヘルパ(_bar_start_for_tf / _calculate_pips)の単体テスト。"""
from datetime import datetime, timezone

import pytest

from trade_trainer_backend.routers.chart import _bar_start_for_tf, _calculate_pips

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
