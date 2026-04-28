"""仕様書 §9 判断結果の事後確認機能のレスポンススキーマ。"""
from pydantic import BaseModel


class StageEvalResp(BaseModel):
    """§9.3 事後 pips / R 表示(ラベル判定は採用しない — principles/no-tags)。

    R 系フィールドは `r_unit_pips` が None の場合 null になる(見送り時でスタイル未選択等)。
    """
    bars: int                           # 10 / 50 / 200
    max_up_pips: float
    max_down_pips: float
    max_abs_pips: float
    max_up_r: float | None = None
    max_down_r: float | None = None
    max_abs_r: float | None = None


class CandidateReview(BaseModel):
    """層 1: 候補外し(★ 付きエントリーしなかった銘柄)。

    R 基準は持たない(SL 未確定なので pips のみで評価)。
    """
    symbol: str
    memo: str | None
    skip_reason: str | None
    ref_price: float | None
    stages: list[StageEvalResp]


class SkipReview(BaseModel):
    """層 2: エントリー見送り(final_decision.has_entry=False)。

    R 基準は持たない(SL 未確定なので pips のみで評価)。
    """
    symbol: str
    reason: str | None
    ref_price: float | None
    stages: list[StageEvalResp]


class EntryReview(BaseModel):
    """§9.5 エントリー結果の事後確認。"""
    symbol: str
    direction: str
    entry_price: float
    sl: float | None
    tp: float | None
    exit_price: float | None
    exit_reason: str | None
    pips_pnl: float | None                # 補助(§17 Trade.pips_pnl)
    ref_price: float | None
    r_unit_pips: float | None             # Trade.sl からの R 基準
    stages: list[StageEvalResp]           # presented_at 起点の見送り同形式(銘柄比較用)
    # §9.5 エントリー結果
    mfe_r: float | None = None            # 保有期間の最大順行 R
    mae_r: float | None = None            # 保有期間の最大逆行 R
    mfe_pips: float | None = None         # 補助
    mae_pips: float | None = None         # 補助
    r_pnl: float | None = None            # 実損益 R
    continuation_bars: int = 0            # 続き観察予定本数
    continuation_available: bool = False  # 決済後 OHLC が取得可能か


class PostReviewResponse(BaseModel):
    candidates: list[CandidateReview] = []   # 層 1
    skip: SkipReview | None = None           # 層 2
    entry: EntryReview | None = None         # エントリー済みの振り返り
