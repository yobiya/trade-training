from datetime import datetime
from pydantic import BaseModel


class CreateSessionRequest(BaseModel):
    # 仕様書 §1.2/§4.1: 日時起点フロー。銘柄は後続で select-symbol エンドポイントで設定する。
    symbol: str | None = None
    date_from: datetime | None = None  # None = 過去5年の範囲でランダム選択
    date_to: datetime | None = None    # None = 30日前まで
    # 仕様書 §4.1: 時間フィルタ。指定された条件に合致する日時のみを抽選する。
    days: list[int] | None = None      # 曜日フィルタ (0=月, 6=日)。空/None は全曜日
    sessions: list[str] | None = None  # "tokyo"|"london"|"ny"。空/None は全時間帯


class SelectSymbolRequest(BaseModel):
    symbol: str


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
    digits: int  # 価格表示小数桁数(MT5 の symbol_info.digits、未取得時は JPY=3/その他=5)

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
