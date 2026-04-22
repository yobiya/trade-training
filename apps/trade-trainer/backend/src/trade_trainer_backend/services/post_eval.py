"""仕様書 §9.2 / §9.3 セッション単位の事後評価(on-demand 計算)。

方針:
- §10 に従い DB には結果を保存しない。API 呼び出し時に都度 market-data から
  事後 OHLC を取得して判定する
- 3 段階(10/50/200 本先)で評価し、それぞれの最大上昇・下落・絶対変動 pips と
  §9.3 ラベル(機会損失 / 正解 / どちらでも)を返す
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


# §9.2 の 3 段階(M5 本数)
LOOKAHEAD_STAGES: tuple[int, ...] = (10, 50, 200)

# §9.3 デフォルト閾値(Setting 化せずコード内定数、値は銘柄系ごとに切替え)
OPPORTUNITY_PIPS_JPY = 20.0
OPPORTUNITY_PIPS_MAJOR = 20.0
NOISE_PIPS_JPY = 10.0
NOISE_PIPS_MAJOR = 10.0

# §9.3 ラベル
LABEL_OPPORTUNITY_LOSS = "opportunity_loss"
LABEL_CORRECT = "correct"
LABEL_NEUTRAL = "neutral"


@dataclass
class StageEval:
    bars: int                 # 10 / 50 / 200
    max_up_pips: float        # 起点価格からの最大上昇 pips
    max_down_pips: float      # 起点価格からの最大下落 pips
    max_abs_pips: float       # max(up, down)
    label: str                # §9.3 ラベル


@dataclass
class SymbolReview:
    symbol: str
    ref_price: float | None   # 起点価格(presented_at の close)
    stages: list[StageEval]   # 3 段階分


def _pip_size(symbol: str) -> float:
    return 0.01 if symbol.upper().endswith("JPY") else 0.0001


def _thresholds(symbol: str) -> tuple[float, float]:
    if symbol.upper().endswith("JPY"):
        return OPPORTUNITY_PIPS_JPY, NOISE_PIPS_JPY
    return OPPORTUNITY_PIPS_MAJOR, NOISE_PIPS_MAJOR


def _classify(max_abs_pips: float, symbol: str) -> str:
    opp, noise = _thresholds(symbol)
    if max_abs_pips >= opp:
        return LABEL_OPPORTUNITY_LOSS
    if max_abs_pips <= noise:
        return LABEL_CORRECT
    return LABEL_NEUTRAL


def _get_reference_price(symbol: str, ref_dt: datetime) -> float | None:
    """ref_dt 時点(presented_at 等)の M5 close を取得する。"""
    from market_data.accessor import get_ohlc
    try:
        df = get_ohlc(symbol, "M5", ref_dt - timedelta(minutes=30), ref_dt + timedelta(minutes=5))
    except Exception:  # noqa: BLE001
        return None
    if df is None or len(df) == 0:
        return None
    return float(df["close"].iloc[-1])


def evaluate_symbol(symbol: str, ref_dt: datetime) -> SymbolReview:
    """指定銘柄について、ref_dt を起点とした 3 段階の事後評価を返す。

    データが取れない場合は stages が空リスト / ref_price が None のレビューを返す
    (呼び出し側で「データなし」として扱える)。
    """
    if ref_dt.tzinfo is None:
        ref_dt = ref_dt.replace(tzinfo=timezone.utc)

    ref_price = _get_reference_price(symbol, ref_dt)
    if ref_price is None:
        return SymbolReview(symbol=symbol, ref_price=None, stages=[])

    # 最大 lookahead(200 本)まで一度に取って、段階別に部分集合で評価する。
    from market_data.accessor import get_ohlc
    max_bars = max(LOOKAHEAD_STAGES)
    # M5 x (max_bars + バッファ) を未来方向に
    to_dt = ref_dt + timedelta(minutes=5 * (max_bars + 20))
    try:
        df = get_ohlc(symbol, "M5", ref_dt, to_dt)
    except Exception:  # noqa: BLE001
        return SymbolReview(symbol=symbol, ref_price=ref_price, stages=[])
    if df is None or len(df) == 0:
        return SymbolReview(symbol=symbol, ref_price=ref_price, stages=[])

    psize = _pip_size(symbol)
    stages: list[StageEval] = []
    for bars in LOOKAHEAD_STAGES:
        window = df.head(bars)
        if len(window) == 0:
            continue
        max_up_raw = float(window["high"].max()) - ref_price
        max_down_raw = ref_price - float(window["low"].min())
        max_up_pips = max(0.0, max_up_raw / psize)
        max_down_pips = max(0.0, max_down_raw / psize)
        max_abs_pips = max(max_up_pips, max_down_pips)
        stages.append(StageEval(
            bars=bars,
            max_up_pips=round(max_up_pips, 1),
            max_down_pips=round(max_down_pips, 1),
            max_abs_pips=round(max_abs_pips, 1),
            label=_classify(max_abs_pips, symbol),
        ))
    return SymbolReview(symbol=symbol, ref_price=ref_price, stages=stages)
