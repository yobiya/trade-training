"""トレードエントリー・決済エンドポイント。"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import SessionFinalDecision, Trade, TradeSession
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.routers.chart import _calculate_pips
from trade_trainer_backend.schemas.trade import (
    EnterTradeRequest,
    ExitTradeRequest,
    TradeResponse,
)

router = APIRouter(tags=["trades"])


def _trade_to_response(t: Trade) -> TradeResponse:
    return TradeResponse(
        id=t.id,
        direction=t.direction,
        entry_price=t.entry_price,
        sl=t.sl,
        tp=t.tp,
        entry_time=t.entry_time.replace(tzinfo=timezone.utc) if t.entry_time.tzinfo is None else t.entry_time,
        exit_price=t.exit_price,
        exit_reason=t.exit_reason,
        exit_time=t.exit_time.replace(tzinfo=timezone.utc) if t.exit_time and t.exit_time.tzinfo is None else t.exit_time,
        pips_pnl=t.pips_pnl,
        is_open=t.exit_time is None,
        style_id=t.style_id,
    )


@router.post("/sessions/{session_id}/trade/enter", response_model=TradeResponse, status_code=201)
def enter_trade(
    session_id: str,
    body: EnterTradeRequest,
    db: Session = Depends(get_db),
) -> TradeResponse:
    """仕様書 §7.4: エントリー時の必須項目は 方向・価格・SL・TP・スタイル id のみ。
    思考・根拠は横断メモ(Session.note)または銘柄別メモ(SessionCandidate.memo)に自由記述する。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    existing = db.scalars(
        select(Trade).where(Trade.session_id == session_id, Trade.exit_time.is_(None))
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Active trade already exists in this session")

    fd = db.get(SessionFinalDecision, session_id)
    symbol = fd.symbol if fd and fd.symbol else "UNKNOWN"

    current_pos = s.current_position
    trade = Trade(
        id=str(uuid.uuid4()),
        session_id=session_id,
        mode="training",
        symbol=symbol,
        direction=body.direction,
        entry_time=current_pos,
        entry_price=body.price,
        sl=body.sl,
        tp=body.tp,
        style_id=body.style_id,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(trade)

    if fd:
        fd.has_entry = True

    db.commit()
    db.refresh(trade)
    return _trade_to_response(trade)


@router.post("/sessions/{session_id}/trade/exit", response_model=TradeResponse)
def exit_trade(
    session_id: str,
    body: ExitTradeRequest,
    db: Session = Depends(get_db),
) -> TradeResponse:
    """決済。決済理由(TP/SL/裁量)と価格を Trade に記録。決済所感は横断メモに自由記述(§7.7)。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    trade = db.scalars(
        select(Trade).where(Trade.session_id == session_id, Trade.exit_time.is_(None))
    ).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="No active trade in this session")

    fd = db.get(SessionFinalDecision, session_id)
    symbol = fd.symbol if fd and fd.symbol else trade.symbol

    trade.exit_price = body.price
    trade.exit_reason = body.reason
    trade.exit_time = s.current_position
    trade.pips_pnl = _calculate_pips(symbol, trade.direction, trade.entry_price, body.price)

    db.commit()
    db.refresh(trade)
    return _trade_to_response(trade)


@router.get("/sessions/{session_id}/trade", response_model=TradeResponse | None)
def get_active_trade(session_id: str, db: Session = Depends(get_db)) -> TradeResponse | None:
    trade = db.scalars(
        select(Trade).where(Trade.session_id == session_id, Trade.exit_time.is_(None))
    ).first()
    if trade is None:
        return None
    return _trade_to_response(trade)


@router.get("/sessions/{session_id}/trade/latest", response_model=TradeResponse | None)
def get_latest_trade(session_id: str, db: Session = Depends(get_db)) -> TradeResponse | None:
    """最後のトレードを返す(オープン/クローズ問わず、決済結果表示用)。"""
    trade = db.scalars(
        select(Trade).where(Trade.session_id == session_id).order_by(Trade.entry_time.desc())
    ).first()
    if trade is None:
        return None
    return _trade_to_response(trade)
