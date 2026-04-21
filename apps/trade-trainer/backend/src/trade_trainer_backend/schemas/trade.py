from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class ScenarioInput(BaseModel):
    """エントリー時に記録するシナリオメモ(仕様書 §7)。"""
    environment: str | None = None          # 環境認識(必須) - 上位足のトレンド・相場状況
    market_view: str | None = None          # 相場観(必須) - 自分で読んだ通貨強弱
    symbol_reason: str | None = None        # 銘柄選定理由(必須)
    skipped_candidates: str | None = None   # 比較候補の総評(任意、§7.1)
    event_recognition: str | None = None    # 指標認識(必須)
    wave_count: str | None = None           # 波動カウント(任意) - エリオット仮説
    scenario_main: str | None = None        # メインシナリオ(必須)
    scenario_alt1: str | None = None        # 代替シナリオ1(必須)
    scenario_alt2: str | None = None        # 代替シナリオ2(任意 - 視野狭窄のシグナル)
    entry_basis: str | None = None          # エントリー根拠(必須)


class ScenarioResponse(BaseModel):
    environment: str | None
    market_view: str | None
    symbol_reason: str | None
    skipped_candidates: str | None
    event_recognition: str | None
    wave_count: str | None
    scenario_main: str | None
    scenario_alt1: str | None
    scenario_alt2: str | None
    entry_basis: str | None
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
