from datetime import datetime
from pydantic import BaseModel


class OhlcBar(BaseModel):
    t: int      # Unix timestamp (seconds, UTC)
    o: float
    h: float
    l: float
    c: float
    v: int


class ChartStackEntry(BaseModel):
    timeframe: str
    bars: list[OhlcBar]


class ChartStackResponse(BaseModel):
    """全 TF を一度に返す chart-stack 形式(設計 §C.3)。"""
    symbol: str
    current_position: datetime
    stacks: list[ChartStackEntry]


class ChartHistoryResponse(BaseModel):
    """過去バー追加取得(ズームアウト/左パン時の loadMoreHistory 用)。"""
    timeframe: str
    bars: list[OhlcBar]


class AdvanceResponse(BaseModel):
    current_position: datetime
    trade_auto_closed: bool
    trade_exit_reason: str | None = None
    trade_exit_price: float | None = None
    trade_pips_pnl: float | None = None
