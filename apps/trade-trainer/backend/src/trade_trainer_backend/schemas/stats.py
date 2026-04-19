from pydantic import BaseModel


class StatsSummaryResponse(BaseModel):
    total_trades: int
    win_count: int
    loss_count: int
    win_rate: float           # 0.0 ~ 1.0
    total_pips: float
    avg_pips_per_trade: float
    profit_factor: float      # 総獲得pips / 総損失pips (0 if no losses)


class StyleStatsRow(BaseModel):
    """スタイル別の成績集計(仕様書 §10.3 スタイル別成績)。"""
    style_id: str | None              # None は「スタイル未選択」(Phase 2a 以前のレガシー)
    style_name: str
    primary_timeframe: str | None
    total_trades: int
    win_count: int
    loss_count: int
    win_rate: float
    total_pips: float
    avg_pips_per_trade: float
    profit_factor: float
