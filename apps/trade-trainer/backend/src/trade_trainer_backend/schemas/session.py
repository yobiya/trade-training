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
    # §6.3.2: 選定確定時に他候補の見送り理由を一括保存する。
    # key = candidate.id、value = 見送り理由文字列(任意)。
    skip_reasons: dict[int, str | None] | None = None


class AdvanceRequest(BaseModel):
    bars: int = 1  # 進める M5 本数


class SkipSessionRequest(BaseModel):
    """§7.3 層 2 エントリー見送り。reason は必須(訓練価値)だが、全候補見送り経由では
    任意で通す。フロント側で用途に応じて必須/任意を制御する。"""
    reason: str | None = None
    considered_styles: list[str] | None = None  # §8.5 見送り時に検討したスタイル


# §6.3.1 候補管理(ウォッチリスト)
class CreateCandidateRequest(BaseModel):
    symbol: str
    memo: str | None = None


class UpdateCandidateRequest(BaseModel):
    memo: str | None = None


class CandidateResponse(BaseModel):
    id: int
    symbol: str
    memo: str | None
    is_selected: bool
    skip_reason: str | None

    model_config = {"from_attributes": True}


class SessionResponse(BaseModel):
    id: str
    symbol: str
    started_at: datetime
    presented_at: datetime
    current_position: datetime
    mode: str
    is_suspended: bool
    has_active_trade: bool
    digits: int  # 価格表示小数桁数(MT5 の symbol_info.digits、未取得時は JPY=3/その他=5)
    note: str | None = None  # §7.2.2 横断メモ
    candidates: list[CandidateResponse] = []  # §6.3 ウォッチリスト

    model_config = {"from_attributes": True}


class UpdateNoteRequest(BaseModel):
    """§7.2.2 横断メモの更新リクエスト。"""
    note: str | None = None


class SessionListItem(BaseModel):
    id: str
    symbol: str
    started_at: datetime
    presented_at: datetime
    mode: str
    is_suspended: bool

    model_config = {"from_attributes": True}
