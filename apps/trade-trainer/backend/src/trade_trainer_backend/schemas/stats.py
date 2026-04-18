from pydantic import BaseModel


class StatsSummaryResponse(BaseModel):
    total_trades: int
    win_count: int
    loss_count: int
    win_rate: float           # 0.0 ~ 1.0
    total_pips: float
    avg_pips_per_trade: float
    profit_factor: float      # 総獲得pips / 総損失pips (0 if no losses)
