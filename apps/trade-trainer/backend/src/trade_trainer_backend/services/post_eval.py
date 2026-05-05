"""仕様書 §9 判断結果の事後確認機能(on-demand 計算)。

方針:
- principles/no-aggregation.md に従い DB には結果を保存しない
- R:R 比率(R = エントリー時の SL 幅)を一次指標(§9.3)
- pips は補助として併記(スプレッド影響の読み取り用)
- 「機会損失 / 正解 / どちらでも」等のラベル判定は採用しない(§9.3 / principles/no-tags)
- 見送り・候補振り返りは SL 未確定のため R 計算を行わず pips のみで評価する
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from typing import Any

# Trade はファイル管理(`session.json` 内の trade フィールド)の dataclass を渡される想定。
# 関数内では .symbol / .entry_price / .sl / .exit_price / .exit_time /
# .direction / .entry_time のフィールドアクセスのみを使うため
# 構造的型(duck-typed)として扱う。型注釈は Any。
Trade = Any  # type: ignore[misc]


# §9.2 見送り事後評価の 3 段階(M5 本数)
LOOKAHEAD_STAGES: tuple[int, ...] = (10, 50, 200)

# §9.5 続き観察の既定本数(M5)
CONTINUATION_BARS: int = 50

# I-13.3: 「N 本ぶん」の M5 を時間幅で fetch するときの拡張係数。weekend (~65h) +
# 平日連休を吸収するため `5min × N × FACTOR` で取得して df.head(N) でトリムする。
# chart.py の `_FACTOR = 10` と同パターン。N=200 で 166h、N=50 で 41h を確保。
_FETCH_FACTOR = 10


@dataclass
class StageEval:
    bars: int                           # 10 / 50 / 200
    max_up_pips: float                  # 起点からの最大上昇 pips(絶対値)
    max_down_pips: float                # 起点からの最大下落 pips(絶対値)
    max_abs_pips: float                 # max(up, down)
    max_up_r: float | None = None       # R 単位(r_unit_pips が None なら None)
    max_down_r: float | None = None
    max_abs_r: float | None = None


@dataclass
class SymbolReview:
    symbol: str
    ref_price: float | None
    r_unit_pips: float | None           # R 基準(pips)。None なら R 計算なし
    stages: list[StageEval]


@dataclass
class EntryObservation:
    """§9.5 エントリー結果の事後確認(決済済み trade 前提)。

    未決済 trade では全フィールド None(保有中は自動要約を出さない — principles/no-future-info.md)。
    """
    mfe_r: float | None                 # 最大順行 R(direction 考慮)
    mae_r: float | None                 # 最大逆行 R(direction 考慮)
    mfe_pips: float | None              # 補助: 最大順行 pips
    mae_pips: float | None              # 補助: 最大逆行 pips
    r_pnl: float | None                 # 実損益 R
    r_unit_pips: float | None           # この trade の R 基準(pips)
    continuation_bars: int              # 続き観察予定本数
    continuation_available: bool        # 実際に OHLC が 1 本以上取得できたか


# --------------------------------------------------------------------------- #
# ヘルパー
# --------------------------------------------------------------------------- #

def _pip_size(symbol: str) -> float:
    return 0.01 if symbol.upper().endswith("JPY") else 0.0001


def resolve_trade_r_unit_pips(trade: Trade) -> float | None:
    """§9.3 エントリー時の R 基準 = 実 SL 幅(pips)。SL 未設定なら None。"""
    if trade.sl is None:
        return None
    psize = _pip_size(trade.symbol)
    return abs(float(trade.entry_price) - float(trade.sl)) / psize


def quick_r_pnl(trade: Trade) -> float | None:
    """OHLC を使わず entry/sl/exit/direction だけで実損益 R を算出する軽量版(一覧表示用)。

    決済済み + SL 設定済みのみ算出。それ以外は None。
    `evaluate_entry()` が市場データアクセスを伴うのに対し、こちらは代数計算のみ。
    """
    if trade.exit_price is None or trade.sl is None:
        return None
    psize = _pip_size(trade.symbol)
    r_unit = abs(float(trade.entry_price) - float(trade.sl)) / psize
    if r_unit <= 0:
        return None
    diff_pips = (float(trade.exit_price) - float(trade.entry_price)) / psize
    if trade.direction == "sell":
        diff_pips = -diff_pips
    return round(diff_pips / r_unit, 2)


def _to_r(pips: float | None, r_unit: float | None) -> float | None:
    if pips is None or r_unit is None or r_unit <= 0:
        return None
    return round(pips / r_unit, 2)


def _get_reference_price(symbol: str, ref_dt: datetime) -> float | None:
    """ref_dt 時点の M5 close を取得する。"""
    from market_data.accessor import get_ohlc
    try:
        df = get_ohlc(symbol, "M5", ref_dt - timedelta(minutes=30), ref_dt + timedelta(minutes=5))
    except Exception:  # noqa: BLE001
        return None
    if df is None or len(df) == 0:
        return None
    return float(df["close"].iloc[-1])


# --------------------------------------------------------------------------- #
# § 9.3 見送り事後評価(銘柄単位で 3 段階 pips/R を返す)
# --------------------------------------------------------------------------- #

def evaluate_symbol(
    symbol: str,
    ref_dt: datetime,
    r_unit_pips: float | None = None,
) -> SymbolReview:
    """指定銘柄・起点から 3 段階の最大上昇/下落 pips と R を返す(§9.3)。

    `r_unit_pips` が None なら R は算出しない(StageEval の R フィールドは None)。
    """
    if ref_dt.tzinfo is None:
        ref_dt = ref_dt.replace(tzinfo=timezone.utc)

    ref_price = _get_reference_price(symbol, ref_dt)
    if ref_price is None:
        return SymbolReview(symbol=symbol, ref_price=None, r_unit_pips=r_unit_pips, stages=[])

    from market_data.accessor import get_ohlc
    max_bars = max(LOOKAHEAD_STAGES)
    # I-13.3: weekend / 連休吸収のため bars × 5min × FACTOR で過剰取得し df.head(N) で
    # トリムする(chart.py と同パターン)。時間幅 fetch のままだと金曜深夜 ref_dt で
    # M5 が 24 本しか取れず 200 本ステージが過小評価になっていた。
    to_dt = ref_dt + timedelta(minutes=5 * max_bars * _FETCH_FACTOR)
    try:
        df = get_ohlc(symbol, "M5", ref_dt, to_dt)
    except Exception:  # noqa: BLE001
        return SymbolReview(symbol=symbol, ref_price=ref_price, r_unit_pips=r_unit_pips, stages=[])
    if df is None or len(df) == 0:
        return SymbolReview(symbol=symbol, ref_price=ref_price, r_unit_pips=r_unit_pips, stages=[])

    psize = _pip_size(symbol)
    stages: list[StageEval] = []
    for bars in LOOKAHEAD_STAGES:
        window = df.head(bars)
        if len(window) == 0:
            continue
        max_up_pips = round(max(0.0, (float(window["high"].max()) - ref_price) / psize), 1)
        max_down_pips = round(max(0.0, (ref_price - float(window["low"].min())) / psize), 1)
        max_abs_pips = max(max_up_pips, max_down_pips)
        stages.append(StageEval(
            bars=bars,
            max_up_pips=max_up_pips,
            max_down_pips=max_down_pips,
            max_abs_pips=max_abs_pips,
            max_up_r=_to_r(max_up_pips, r_unit_pips),
            max_down_r=_to_r(max_down_pips, r_unit_pips),
            max_abs_r=_to_r(max_abs_pips, r_unit_pips),
        ))
    return SymbolReview(symbol=symbol, ref_price=ref_price, r_unit_pips=r_unit_pips, stages=stages)


# --------------------------------------------------------------------------- #
# § 9.5 エントリー結果の事後確認
# --------------------------------------------------------------------------- #

def evaluate_entry(trade: Trade) -> EntryObservation:
    """§9.5 決済済み trade について MFE / MAE / 実損益 R / 続き観察可否を算出。

    保有期間(entry_time〜exit_time)の M5 OHLC から direction に応じた順行/逆行幅を取る。
    未決済 trade は全フィールド None(principles/no-future-info.md: 保有中は自動要約を出さない)。
    """
    empty = EntryObservation(
        mfe_r=None, mae_r=None, mfe_pips=None, mae_pips=None,
        r_pnl=None, r_unit_pips=resolve_trade_r_unit_pips(trade),
        continuation_bars=CONTINUATION_BARS, continuation_available=False,
    )

    if trade.exit_time is None or trade.exit_price is None:
        return empty

    entry_time = trade.entry_time
    if entry_time.tzinfo is None:
        entry_time = entry_time.replace(tzinfo=timezone.utc)
    exit_time = trade.exit_time
    if exit_time.tzinfo is None:
        exit_time = exit_time.replace(tzinfo=timezone.utc)

    r_unit_pips = empty.r_unit_pips
    psize = _pip_size(trade.symbol)

    # 保有期間の M5 OHLC から MFE/MAE を算出
    from market_data.accessor import get_ohlc
    mfe_pips: float | None = None
    mae_pips: float | None = None
    try:
        df = get_ohlc(trade.symbol, "M5", entry_time, exit_time + timedelta(minutes=5))
    except Exception:  # noqa: BLE001
        df = None

    if df is not None and len(df) > 0:
        entry_px = float(trade.entry_price)
        if trade.direction == "buy":
            max_favor_raw = float(df["high"].max()) - entry_px
            max_adverse_raw = entry_px - float(df["low"].min())
        else:  # sell
            max_favor_raw = entry_px - float(df["low"].min())
            max_adverse_raw = float(df["high"].max()) - entry_px
        mfe_pips = round(max(0.0, max_favor_raw / psize), 1)
        mae_pips = round(max(0.0, max_adverse_raw / psize), 1)

    # 実損益 R = (exit - entry) / (entry - sl) × sign(direction) を pip 換算で
    r_pnl: float | None = None
    if r_unit_pips is not None and r_unit_pips > 0:
        exit_diff_pips = (float(trade.exit_price) - float(trade.entry_price)) / psize
        if trade.direction == "sell":
            exit_diff_pips = -exit_diff_pips
        r_pnl = round(exit_diff_pips / r_unit_pips, 2)

    # 続き観察の OHLC 取得可否(チャートはフロントが /chart 経由で別途取得)
    # I-13.3: weekend / 連休を吸収するため CONTINUATION_BARS × 5min × FACTOR で取得。
    # 単純な (CONTINUATION_BARS + 5) × 5min = 4.6h だと金曜引け直後の trade で
    # weekend 65h を跨げず continuation_available が誤って False になる。
    continuation_available = False
    try:
        cont_df = get_ohlc(
            trade.symbol, "M5",
            exit_time + timedelta(minutes=5),
            exit_time + timedelta(minutes=5 * CONTINUATION_BARS * _FETCH_FACTOR),
        )
        continuation_available = cont_df is not None and len(cont_df) > 0
    except Exception:  # noqa: BLE001
        continuation_available = False

    return EntryObservation(
        mfe_r=_to_r(mfe_pips, r_unit_pips),
        mae_r=_to_r(mae_pips, r_unit_pips),
        mfe_pips=mfe_pips,
        mae_pips=mae_pips,
        r_pnl=r_pnl,
        r_unit_pips=r_unit_pips,
        continuation_bars=CONTINUATION_BARS,
        continuation_available=continuation_available,
    )
