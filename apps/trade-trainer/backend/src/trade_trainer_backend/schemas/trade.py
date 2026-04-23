from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class EnterTradeRequest(BaseModel):
    """仕様書 §7.4: エントリー必須は方向・価格・SL・TP・スタイル id のみ。
    根拠・シナリオ等は横断メモ(Session.note)/ 銘柄別メモ(SessionCandidate.memo)に自由記述。

    統合フロー(§6.1)対応: エントリーアクションで銘柄が確定するため、`symbol` を必須にする。
    """
    symbol: str
    direction: Literal["buy", "sell"]
    price: float
    sl: float
    tp: float | None = None
    style_id: str | None = None


class ExitTradeRequest(BaseModel):
    """決済: 数値情報のみ。所感は横断メモに書く(§7.7)。"""
    price: float
    reason: Literal["manual", "tp", "sl"] = "manual"


class TradeResponse(BaseModel):
    id: str
    symbol: str
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
    style_id: str | None = None

    model_config = {"from_attributes": True}
