from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class EnterTradeRequest(BaseModel):
    direction: Literal["buy", "sell"]
    price: float
    sl: float
    tp: float | None = None


class ExitTradeRequest(BaseModel):
    price: float
    reason: Literal["manual"] = "manual"


class TradeResponse(BaseModel):
    id: str
    direction: str
    entry_price: float
    sl: float
    tp: float | None
    entry_time: datetime
    exit_price: float | None
    exit_reason: str | None
    exit_time: datetime | None
    pips_pnl: float | None
    is_open: bool

    model_config = {"from_attributes": True}
