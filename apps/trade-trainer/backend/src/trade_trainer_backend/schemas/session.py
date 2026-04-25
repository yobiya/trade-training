from datetime import datetime
from pydantic import BaseModel


class CreateSessionRequest(BaseModel):
    # 仕様書 §1.2/§4.1/§6.1(統合フロー): 日時起点。銘柄はエントリー時に確定するためここでは指定しない。
    date_from: datetime | None = None  # None = 過去5年の範囲でランダム選択
    date_to: datetime | None = None    # None = 30日前まで
    # 仕様書 §4.1: 時間フィルタ。指定された条件に合致する日時のみを抽選する。
    days: list[int] | None = None      # 曜日フィルタ (0=月, 6=日)。空/None は全曜日
    sessions: list[str] | None = None  # "tokyo"|"london"|"ny"。空/None は全時間帯


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
    """ver 1.45 でファイル管理に移行(`candidates/{symbol}.md`)。
    `id` は symbol そのもの(後方互換のため文字列として返す)。
    `skip_reason` は仕様上 memo 本文に統合されたため常に None。
    """
    id: str
    symbol: str
    memo: str | None
    is_selected: bool
    skip_reason: str | None = None


class SessionResponse(BaseModel):
    id: str
    symbol: str
    started_at: datetime
    presented_at: datetime
    current_position: datetime
    mode: str
    is_settled: bool                   # ver 1.45: §4.2.1 状態モデル(settled_at != null)
    has_active_trade: bool
    digits: int  # 価格表示小数桁数(MT5 の symbol_info.digits、未取得時は JPY=3/その他=5)
    name: str | None = None  # §6.1 任意のセッション名(手法識別用、いつでも編集可)
    note: str | None = None  # §7.2.2 横断メモ
    candidates: list[CandidateResponse] = []  # §6.3 ウォッチリスト
    settled_at: datetime | None = None  # §4.2.1 決着時刻(進行中なら null)


class UpdateNoteRequest(BaseModel):
    """§7.2.2 横断メモの更新リクエスト。"""
    note: str | None = None


class UpdateSessionNameRequest(BaseModel):
    """§6.1 セッション名の更新リクエスト。空文字は null として保存。"""
    name: str | None = None


class SessionListItem(BaseModel):
    id: str
    symbol: str
    started_at: datetime
    presented_at: datetime
    mode: str
    is_settled: bool                     # ver 1.45: §4.2.1 状態モデル
    name: str | None = None              # §6.1 セッション名(任意)
    r_pnl: float | None = None           # §9.5 実損益 R(決済済みのみ、§17 で動的算出)
    pips_pnl: float | None = None        # 補助指標、§17 Trade.pips_pnl
    settled_at: datetime | None = None
