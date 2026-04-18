from datetime import datetime
from pydantic import BaseModel


class OhlcBar(BaseModel):
    t: int      # Unix timestamp (seconds, UTC)
    o: float
    h: float
    l: float
    c: float
    v: int


class ChartResponse(BaseModel):
    bars: list[OhlcBar]
    current_position: datetime
    timeframe: str


class AdvanceResponse(BaseModel):
    new_bars: list[OhlcBar]
    current_position: datetime
    trade_auto_closed: bool
    trade_exit_reason: str | None = None
    trade_exit_price: float | None = None
    trade_pips_pnl: float | None = None
