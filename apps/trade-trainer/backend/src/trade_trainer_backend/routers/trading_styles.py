"""トレードスタイルの CRUD(仕様書 §8)。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import TradingStyle
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.trading_style import (
    CreateStyleRequest,
    TradingStyleResponse,
    UpdateStyleRequest,
)

router = APIRouter(prefix="/trading-styles", tags=["trading-styles"])


def _to_response(s: TradingStyle) -> TradingStyleResponse:
    return TradingStyleResponse(
        id=s.id,
        name=s.name,
        primary_timeframe=s.primary_timeframe,
        expected_hold_time=s.expected_hold_time,
        expected_rr=s.expected_rr,
        typical_sl_pips=s.typical_sl_pips,
        description=s.description,
        is_active=s.is_active,
    )


@router.get("", response_model=list[TradingStyleResponse])
def list_styles(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
) -> list[TradingStyleResponse]:
    stmt = select(TradingStyle)
    if not include_inactive:
        stmt = stmt.where(TradingStyle.is_active.is_(True))
    rows = db.scalars(stmt).all()
    return [_to_response(s) for s in rows]


@router.post("", response_model=TradingStyleResponse, status_code=201)
def create_style(body: CreateStyleRequest, db: Session = Depends(get_db)) -> TradingStyleResponse:
    if db.get(TradingStyle, body.id) is not None:
        raise HTTPException(status_code=409, detail=f"Style '{body.id}' already exists")
    s = TradingStyle(
        id=body.id,
        name=body.name,
        primary_timeframe=body.primary_timeframe,
        expected_hold_time=body.expected_hold_time,
        expected_rr=body.expected_rr,
        typical_sl_pips=body.typical_sl_pips,
        description=body.description,
        is_active=True,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _to_response(s)


@router.patch("/{style_id}", response_model=TradingStyleResponse)
def update_style(
    style_id: str, body: UpdateStyleRequest, db: Session = Depends(get_db),
) -> TradingStyleResponse:
    s = db.get(TradingStyle, style_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Style not found")
    for field in ("name", "primary_timeframe", "expected_hold_time", "expected_rr",
                  "typical_sl_pips", "description", "is_active"):
        v = getattr(body, field)
        if v is not None:
            setattr(s, field, v)
    db.commit()
    db.refresh(s)
    return _to_response(s)


@router.delete("/{style_id}", status_code=204)
def delete_style(style_id: str, db: Session = Depends(get_db)) -> None:
    """論理削除(is_active = False)。既に無効なら 404 ではなく成功扱い。"""
    s = db.get(TradingStyle, style_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Style not found")
    s.is_active = False
    db.commit()
