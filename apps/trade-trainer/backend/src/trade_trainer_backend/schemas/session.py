from datetime import datetime
from pydantic import BaseModel


class CreateSessionRequest(BaseModel):
    symbol: str
    date_from: datetime | None = None  # None = 過去5年の範囲でランダム選択
    date_to: datetime | None = None    # None = 30日前まで


class AdvanceRequest(BaseModel):
    bars: int = 1  # 進める M5 本数


class SkipSessionRequest(BaseModel):
    reason: str | None = None


class SessionResponse(BaseModel):
    id: str
    symbol: str
    started_at: datetime
    presented_at: datetime
    current_position: datetime
    mode: str
    is_suspended: bool
    has_active_trade: bool
    is_complete: bool  # skip or trade exited

    model_config = {"from_attributes": True}


class SessionListItem(BaseModel):
    id: str
    symbol: str
    started_at: datetime
    presented_at: datetime
    mode: str
    is_suspended: bool
    is_complete: bool

    model_config = {"from_attributes": True}
