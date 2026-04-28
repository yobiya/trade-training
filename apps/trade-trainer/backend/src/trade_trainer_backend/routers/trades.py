"""トレードエントリー・決済エンドポイント(ver 1.45 でファイル管理化)。"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from trade_trainer_backend.routers._helpers import ensure_session
from trade_trainer_backend.routers.chart import _calculate_pips
from trade_trainer_backend.schemas.trade import (
    EnterTradeRequest,
    ExitTradeRequest,
    TradeResponse,
)
from trade_trainer_backend.services import session_store
from trade_trainer_backend.services.session_models import FinalDecision, Trade
from trade_trainer_backend.utils.http import not_found

router = APIRouter(tags=["trades"])


def _trade_to_response(t: Trade) -> TradeResponse:
    entry_time = t.entry_time.replace(tzinfo=timezone.utc) if t.entry_time.tzinfo is None else t.entry_time
    exit_time = (
        t.exit_time.replace(tzinfo=timezone.utc)
        if t.exit_time and t.exit_time.tzinfo is None
        else t.exit_time
    )
    return TradeResponse(
        id=t.id,
        symbol=t.symbol,
        direction=t.direction,
        entry_price=t.entry_price,
        sl=t.sl,
        tp=t.tp,
        entry_time=entry_time,
        exit_price=t.exit_price,
        exit_reason=t.exit_reason,
        exit_time=exit_time,
        pips_pnl=t.pips_pnl,
        is_open=t.exit_time is None,
    )


def _upsert_candidate_on_entry(session_id: str, symbol: str) -> None:
    """統合フロー §6.3.2: エントリーした銘柄の銘柄別メモが無ければ
    テンプレートを初期挿入して作成する(is_selected はファイル管理では trade.symbol で導出)。"""
    if session_store.get_candidate(session_id, symbol) is not None:
        return
    from trade_trainer_backend.services.memo_templates import get_candidate_template
    initial_memo = get_candidate_template()
    session_store.save_candidate(session_id, symbol, initial_memo)


@router.post("/sessions/{session_id}/trade/enter", response_model=TradeResponse, status_code=201)
def enter_trade(session_id: str, body: EnterTradeRequest) -> TradeResponse:
    """仕様書 §7.4 + §6.1 統合フロー:
    エントリー時の必須項目は symbol + 方向・価格・SL・TP。
    エントリー動作そのものが「この銘柄で選定確定」の意味を持つ(§6.3.2)。"""
    agg = ensure_session(session_id)
    if agg.trade is not None and agg.trade.exit_time is None:
        raise HTTPException(status_code=409, detail="Active trade already exists in this session")
    if agg.trade is not None and agg.trade.exit_time is not None:
        # 1 セッション 1 エントリー原則(§4.2): 決済済みでも再エントリー不可
        raise HTTPException(status_code=409, detail="This session already has a closed trade (1-entry policy)")

    symbol = body.symbol.upper()
    _upsert_candidate_on_entry(session_id, symbol)

    current_pos = agg.meta.current_position
    if current_pos.tzinfo is None:
        current_pos = current_pos.replace(tzinfo=timezone.utc)

    trade = Trade(
        id=str(uuid.uuid4()),
        symbol=symbol,
        direction=body.direction,
        entry_time=current_pos,
        entry_price=body.price,
        sl=body.sl,
        tp=body.tp,
        exit_time=None,
        exit_price=None,
        exit_reason=None,
        pips_pnl=None,
        amount_pnl=None,
        lot=None,
        mt5_order_id=None,
        created_at=datetime.now(timezone.utc),
    )
    session_store.save_trade(session_id, trade)

    # final_decision: エントリーしたので has_entry=True に確定(以降の見送りはあり得ない)
    fd = FinalDecision(has_entry=True, skip_reason=None)
    session_store.save_final_decision(session_id, fd)

    # ディレクトリ名を pending → symbol に rename
    session_store.rename_dir(session_id)

    return _trade_to_response(trade)


@router.post("/sessions/{session_id}/trade/exit", response_model=TradeResponse)
def exit_trade(session_id: str, body: ExitTradeRequest) -> TradeResponse:
    """決済。決済理由(TP/SL/裁量)と価格を trade.json に記録。"""
    agg = ensure_session(session_id)
    if agg.trade is None or agg.trade.exit_time is not None:
        raise not_found("No active trade in this session")

    current_pos = agg.meta.current_position
    if current_pos.tzinfo is None:
        current_pos = current_pos.replace(tzinfo=timezone.utc)

    trade = agg.trade
    trade.exit_price = body.price
    trade.exit_reason = body.reason
    trade.exit_time = current_pos
    trade.pips_pnl = _calculate_pips(trade.symbol, trade.direction, trade.entry_price, body.price)
    session_store.save_trade(session_id, trade)

    return _trade_to_response(trade)


@router.get("/sessions/{session_id}/trade", response_model=TradeResponse | None)
def get_active_trade(session_id: str) -> TradeResponse | None:
    agg = ensure_session(session_id)
    if agg.trade is None or agg.trade.exit_time is not None:
        return None
    return _trade_to_response(agg.trade)


@router.get("/sessions/{session_id}/trade/latest", response_model=TradeResponse | None)
def get_latest_trade(session_id: str) -> TradeResponse | None:
    """最後のトレードを返す(オープン/クローズ問わず、決済結果表示用)。"""
    agg = ensure_session(session_id)
    if agg.trade is None:
        return None
    return _trade_to_response(agg.trade)
