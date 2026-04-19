"""トレードエントリー・決済エンドポイント。"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import Scenario, SessionFinalDecision, Trade, TradeSession
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.routers.chart import _calculate_pips
from trade_trainer_backend.schemas.trade import (
    EnterTradeRequest,
    ExitTradeRequest,
    ReflectionRequest,
    ScenarioResponse,
    TradeResponse,
)

router = APIRouter(tags=["trades"])


def _scenario_to_response(sc: Scenario | None) -> ScenarioResponse | None:
    if sc is None:
        return None
    return ScenarioResponse(
        scenario_main=sc.scenario_main,
        entry_basis=sc.entry_basis,
        tags=list(sc.tags) if sc.tags else [],
        exit_memo=sc.exit_memo,
        reflection=sc.reflection,
    )


def _trade_to_response(t: Trade, scenario: Scenario | None = None) -> TradeResponse:
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
        scenario=_scenario_to_response(scenario),
    )


@router.post("/sessions/{session_id}/trade/enter", response_model=TradeResponse, status_code=201)
def enter_trade(
    session_id: str,
    body: EnterTradeRequest,
    db: Session = Depends(get_db),
) -> TradeResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # 既存のオープントレードがあれば拒否
    existing = db.scalars(
        select(Trade).where(Trade.session_id == session_id, Trade.exit_time.is_(None))
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Active trade already exists in this session")

    fd = db.get(SessionFinalDecision, session_id)
    symbol = fd.symbol if fd and fd.symbol else "UNKNOWN"

    current_pos = s.current_position
    trade_id = str(uuid.uuid4())
    trade = Trade(
        id=trade_id,
        session_id=session_id,
        mode="training",
        symbol=symbol,
        direction=body.direction,
        entry_time=current_pos,
        entry_price=body.price,
        sl=body.sl,
        tp=body.tp,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(trade)

    scenario: Scenario | None = None
    if body.scenario is not None:
        scenario = Scenario(
            trade_id=trade_id,
            scenario_main=body.scenario.scenario_main,
            entry_basis=body.scenario.entry_basis,
            tags=body.scenario.tags,
        )
        db.add(scenario)

    if fd:
        fd.has_entry = True

    db.commit()
    db.refresh(trade)
    return _trade_to_response(trade, scenario)


@router.post("/sessions/{session_id}/trade/exit", response_model=TradeResponse)
def exit_trade(
    session_id: str,
    body: ExitTradeRequest,
    db: Session = Depends(get_db),
) -> TradeResponse:
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

    scenario = db.get(Scenario, trade.id)
    if body.exit_memo is not None:
        if scenario is None:
            scenario = Scenario(trade_id=trade.id, exit_memo=body.exit_memo)
            db.add(scenario)
        else:
            scenario.exit_memo = body.exit_memo

    db.commit()
    db.refresh(trade)
    if scenario is not None:
        db.refresh(scenario)
    return _trade_to_response(trade, scenario)


@router.post("/sessions/{session_id}/trade/reflection", response_model=TradeResponse)
def upsert_reflection(
    session_id: str,
    body: ReflectionRequest,
    db: Session = Depends(get_db),
) -> TradeResponse:
    """直近(最後)のトレードに振り返りメモを保存する(仕様書 §7.3)。"""
    trade = db.scalars(
        select(Trade).where(Trade.session_id == session_id).order_by(Trade.entry_time.desc())
    ).first()
    if trade is None:
        raise HTTPException(status_code=404, detail="No trade in this session")

    scenario = db.get(Scenario, trade.id)
    if scenario is None:
        scenario = Scenario(trade_id=trade.id, reflection=body.reflection)
        db.add(scenario)
    else:
        scenario.reflection = body.reflection
    db.commit()
    db.refresh(scenario)
    return _trade_to_response(trade, scenario)


@router.get("/sessions/{session_id}/trade", response_model=TradeResponse | None)
def get_active_trade(session_id: str, db: Session = Depends(get_db)) -> TradeResponse | None:
    trade = db.scalars(
        select(Trade).where(Trade.session_id == session_id, Trade.exit_time.is_(None))
    ).first()
    if trade is None:
        return None
    scenario = db.get(Scenario, trade.id)
    return _trade_to_response(trade, scenario)


@router.get("/sessions/{session_id}/trade/latest", response_model=TradeResponse | None)
def get_latest_trade(session_id: str, db: Session = Depends(get_db)) -> TradeResponse | None:
    """決済後メモ・振り返りメモ表示用に、最後のトレードを返す(オープン/クローズ問わず)。"""
    trade = db.scalars(
        select(Trade).where(Trade.session_id == session_id).order_by(Trade.entry_time.desc())
    ).first()
    if trade is None:
        return None
    scenario = db.get(Scenario, trade.id)
    return _trade_to_response(trade, scenario)
