from datetime import datetime
from typing import Literal
from pydantic import BaseModel


class EnterTradeRequest(BaseModel):
    """仕様書 §7.4: エントリー必須は方向・価格・SL・TP のみ。
    根拠・シナリオ等は横断メモ(Session.note)/ 銘柄別メモ(SessionCandidate.memo)に自由記述。

    統合フロー(§6.1)対応: エントリーアクションで銘柄が確定するため、`symbol` を必須にする。
    `entry_tf`(§5.1.5 フォーカス TF)はエントリー時の advance 単位 / マーカー描画 TF として保存する。
    """
    symbol: str
    direction: Literal["buy", "sell"]
    entry_tf: str
    price: float
    sl: float
    tp: float | None = None


class ExitTradeRequest(BaseModel):
    """決済: 数値情報のみ。所感は横断メモに書く(§7.7)。"""
    price: float
    reason: Literal["manual", "tp", "sl"] = "manual"


class UpdateTradeRequest(BaseModel):
    """仕様 §5.5.5: 保有中の SL/TP drag 移動で送られる部分更新。entry_price / direction /
    entry_tf は履歴のため更新不可。"""
    sl: float | None = None
    tp: float | None = None


class TradeResponse(BaseModel):
    id: str
    symbol: str
    direction: str
    entry_tf: str
    entry_price: float
    sl: float
    tp: float | None
    entry_time: datetime
    exit_price: float | None
    exit_reason: str | None
    exit_time: datetime | None
    pips_pnl: float | None
    is_open: bool

    model_config = {"from_attributes": True}
