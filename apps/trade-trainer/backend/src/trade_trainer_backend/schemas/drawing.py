from typing import Any, Literal
from pydantic import BaseModel


DrawingKind = Literal["line", "trendline", "fibonacci", "label"]


class CreateDrawingRequest(BaseModel):
    """仕様書 §5.3/§5.5 の描画作成。

    `data` は kind ごとに構造が異なる:
      - line(水平線):   { "price": float }
      - trendline:      { "points": [{"t": int, "price": float}, {"t": int, "price": float}] }
      - fibonacci:      { "points": [{"t": int, "price": float}, {"t": int, "price": float}] }
      - label:          { "t": int, "price": float, "text": str }
    """
    kind: DrawingKind
    data: dict[str, Any]
    label: str | None = None
    timeframe: str | None = None
    visible_on_timeframes: list[str] | None = None


class UpdateDrawingRequest(BaseModel):
    """部分更新用。指定されたフィールドのみ書き換える。"""
    data: dict[str, Any] | None = None
    label: str | None = None
    visible_on_timeframes: list[str] | None = None


class DrawingResponse(BaseModel):
    id: int
    session_id: str
    kind: str
    data: dict[str, Any]
    label: str | None
    timeframe: str | None
    visible_on_timeframes: list[str] | None

    model_config = {"from_attributes": True}
