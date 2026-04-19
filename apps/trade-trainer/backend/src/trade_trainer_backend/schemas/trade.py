from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class ScenarioInput(BaseModel):
    """エントリー時に記録するシナリオメモ(仕様書 §7.1 最小版)。"""
    scenario_main: str | None = None   # メモ本文(想定する主要な展開)
    entry_basis: str | None = None     # エントリー根拠(具体的なトリガー)
    tags: list[str] = []


class ScenarioResponse(BaseModel):
    scenario_main: str | None
    entry_basis: str | None
    tags: list[str]
    exit_memo: str | None
    reflection: str | None

    model_config = {"from_attributes": True}


class EnterTradeRequest(BaseModel):
    direction: Literal["buy", "sell"]
    price: float
    sl: float
    tp: float | None = None
    scenario: ScenarioInput | None = None
    # 仕様書 §7.1/§8: エントリー時に選択したトレードスタイル
    style_id: str | None = None
    style_selection_reason: str | None = None


class ExitTradeRequest(BaseModel):
    price: float
    reason: Literal["manual"] = "manual"
    exit_memo: str | None = None


class ReflectionRequest(BaseModel):
    reflection: str


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
    scenario: ScenarioResponse | None = None
    style_id: str | None = None
    style_selection_reason: str | None = None

    model_config = {"from_attributes": True}
