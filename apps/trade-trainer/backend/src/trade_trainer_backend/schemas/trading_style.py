from pydantic import BaseModel


class TradingStyleResponse(BaseModel):
    id: str
    name: str
    primary_timeframe: str
    expected_hold_time: str
    expected_rr: str
    typical_sl_pips: str
    description: str | None
    is_active: bool

    model_config = {"from_attributes": True}


class CreateStyleRequest(BaseModel):
    """新規スタイルを追加する(仕様書 §8.2)。"""
    id: str
    name: str
    primary_timeframe: str
    expected_hold_time: str
    expected_rr: str
    typical_sl_pips: str
    description: str | None = None


class UpdateStyleRequest(BaseModel):
    """スタイル部分更新。未指定フィールドは変更しない。"""
    name: str | None = None
    primary_timeframe: str | None = None
    expected_hold_time: str | None = None
    expected_rr: str | None = None
    typical_sl_pips: str | None = None
    description: str | None = None
    is_active: bool | None = None
