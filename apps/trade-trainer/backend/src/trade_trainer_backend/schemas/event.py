"""経済指標スキーマ(仕様書 §5.4)。"""
from datetime import datetime

from pydantic import BaseModel


class EconomicEventResponse(BaseModel):
    """経済指標 1 件。未来の発表については actual/surprise を null にして返す。"""
    id: int
    event_time: datetime  # UTC
    currency: str
    name: str
    importance: int  # 1-3
    actual: float | None
    forecast: float | None
    previous: float | None
    surprise: float | None

    model_config = {"from_attributes": True}
