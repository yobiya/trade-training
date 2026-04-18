"""セッション管理エンドポイント。"""
import random
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import SessionFinalDecision, TradeSession
from trade_trainer_backend.config import Settings, get_settings
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.session import (
    CreateSessionRequest,
    SessionListItem,
    SessionResponse,
    SkipSessionRequest,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _build_response(s: TradeSession, db: Session) -> SessionResponse:
    fd = db.get(SessionFinalDecision, s.id)
    symbol = fd.symbol if fd else ""
    from shared_schema.models.trading import Trade
    active_trade = db.scalars(
        select(Trade).where(Trade.session_id == s.id, Trade.exit_time.is_(None))
    ).first()
    is_complete = fd is not None and (fd.has_entry is False or active_trade is None)
    return SessionResponse(
        id=s.id,
        symbol=symbol or "",
        started_at=s.started_at,
        presented_at=s.presented_at,
        current_position=s.current_position,
        mode=s.mode,
        is_suspended=s.is_suspended,
        has_active_trade=active_trade is not None,
        is_complete=is_complete,
    )


def _random_presented_at(settings: Settings) -> datetime:
    """過去 history_max_days ~ history_min_days の範囲でランダムな M5 日時を返す。"""
    now = datetime.now(timezone.utc)
    offset_secs = random.randint(
        settings.history_min_days * 86400,
        settings.history_max_days * 86400,
    )
    dt = now - timedelta(seconds=offset_secs)
    # M5 に丸める
    minutes = (dt.minute // 5) * 5
    return dt.replace(minute=minutes, second=0, microsecond=0, tzinfo=timezone.utc)


@router.post("", response_model=SessionResponse, status_code=201)
def create_session(
    body: CreateSessionRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SessionResponse:
    if body.date_from and body.date_to:
        # 指定範囲内でランダム
        from_ts = int(body.date_from.timestamp())
        to_ts = int(body.date_to.timestamp())
        if to_ts <= from_ts:
            raise HTTPException(status_code=400, detail="date_to must be after date_from")
        offset = random.randint(0, to_ts - from_ts)
        presented_at = datetime.fromtimestamp(from_ts + offset, tz=timezone.utc)
        minutes = (presented_at.minute // 5) * 5
        presented_at = presented_at.replace(minute=minutes, second=0, microsecond=0)
    else:
        presented_at = _random_presented_at(settings)

    now = datetime.now(timezone.utc)
    session_id = str(uuid.uuid4())

    ts = TradeSession(
        id=session_id,
        started_at=now,
        presented_at=presented_at,
        current_position=presented_at,
        mode="training",
        is_suspended=False,
    )
    fd = SessionFinalDecision(
        session_id=session_id,
        symbol=body.symbol.upper(),
        has_entry=False,
    )
    db.add(ts)
    db.add(fd)
    db.commit()
    db.refresh(ts)
    return _build_response(ts, db)


@router.get("", response_model=list[SessionListItem])
def list_sessions(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> list[SessionListItem]:
    sessions = db.scalars(
        select(TradeSession)
        .where(TradeSession.mode == "training")
        .order_by(TradeSession.started_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    result = []
    for s in sessions:
        fd = db.get(SessionFinalDecision, s.id)
        from shared_schema.models.trading import Trade
        active = db.scalars(
            select(Trade).where(Trade.session_id == s.id, Trade.exit_time.is_(None))
        ).first()
        is_complete = fd is not None and (fd.has_entry is False or active is None)
        result.append(
            SessionListItem(
                id=s.id,
                symbol=fd.symbol if fd else "",
                started_at=s.started_at,
                presented_at=s.presented_at,
                mode=s.mode,
                is_suspended=s.is_suspended,
                is_complete=is_complete,
            )
        )
    return result


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: str, db: Session = Depends(get_db)) -> SessionResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return _build_response(s, db)


@router.post("/{session_id}/skip", response_model=SessionResponse)
def skip_session(
    session_id: str,
    body: SkipSessionRequest,
    db: Session = Depends(get_db),
) -> SessionResponse:
    """見送り: エントリーせずにセッションを完了する。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    fd = db.get(SessionFinalDecision, session_id)
    if fd:
        fd.has_entry = False
        fd.skip_reason = body.reason
    db.commit()
    return _build_response(s, db)


@router.patch("/{session_id}/suspend", response_model=SessionResponse)
def suspend_session(session_id: str, db: Session = Depends(get_db)) -> SessionResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    s.is_suspended = True
    db.commit()
    return _build_response(s, db)


@router.patch("/{session_id}/resume", response_model=SessionResponse)
def resume_session(session_id: str, db: Session = Depends(get_db)) -> SessionResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    s.is_suspended = False
    db.commit()
    return _build_response(s, db)
