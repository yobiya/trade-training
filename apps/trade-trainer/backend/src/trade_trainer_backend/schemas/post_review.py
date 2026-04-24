"""仕様書 §9.2 見送り事後検証のレスポンススキーマ。"""
from pydantic import BaseModel


class StageEvalResp(BaseModel):
    """§9.3 事後 pips 表示(ラベル判定は採用しない — principles/no-tags)。"""
    bars: int                    # 10 / 50 / 200
    max_up_pips: float
    max_down_pips: float
    max_abs_pips: float


class CandidateReview(BaseModel):
    """層 1: 候補外し"""
    symbol: str
    memo: str | None
    skip_reason: str | None
    ref_price: float | None
    stages: list[StageEvalResp]


class SkipReview(BaseModel):
    """層 2: エントリー見送り(final_decision に symbol があり has_entry=False)"""
    symbol: str
    reason: str | None
    considered_styles: list[str] | None
    ref_price: float | None
    stages: list[StageEvalResp]


class EntryReview(BaseModel):
    """エントリー済みトレードの振り返り(§9.4)。"""
    symbol: str
    direction: str
    entry_price: float
    sl: float | None
    tp: float | None
    exit_price: float | None
    exit_reason: str | None
    pips_pnl: float | None
    ref_price: float | None
    stages: list[StageEvalResp]   # 同じ見送り事後と並べて比較できるよう同形式で返す


class PostReviewResponse(BaseModel):
    candidates: list[CandidateReview] = []   # 層 1
    skip: SkipReview | None = None           # 層 2
    entry: EntryReview | None = None         # エントリー済みの振り返り
