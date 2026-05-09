from typing import Any, Literal
from pydantic import BaseModel


DrawingKind = Literal[
    "line",
    "vline",
    "trendline",
    "channel",
    "fibonacci",
    "wave_label",
    "high_break",
    "low_break",
]


class CreateDrawingRequest(BaseModel):
    """仕様書 §5.3/§5.5 の描画作成。

    `data` は kind ごとに構造が異なる:
      - line(水平線):   { "price": float }
      - vline(縦線):    { "t": int }
      - trendline:      { "points": [{"t": int, "price": float}, {"t": int, "price": float}] }
      - channel:        { "points": [{"t": int, "price": float} × 3] }  // p1-p2 が基準線、p3 が平行線アンカー
      - fibonacci:      { "points": [{"t": int, "price": float}, {"t": int, "price": float}] }
      - wave_label:     { "t": int, "price": float, "wave": str ('1'|'2'|'3'|'4'|'5'|'A'|'B'|'C')}
      - high_break:     { "t": int, "price": float }  // price = 選択バー高値 snapshot
      - low_break:      { "t": int, "price": float }  // price = 選択バー安値 snapshot

    `symbol` は統合フロー(§6.1)対応: 銘柄別に描画を紐付け、銘柄切替時に該当銘柄のみ表示する。
    """
    kind: DrawingKind
    data: dict[str, Any]
    label: str | None = None
    symbol: str | None = None
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
    symbol: str | None = None
    timeframe: str | None
    visible_on_timeframes: list[str] | None

    model_config = {"from_attributes": True}
