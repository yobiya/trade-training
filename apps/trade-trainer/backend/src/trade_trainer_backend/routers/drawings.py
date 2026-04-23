"""描画オブジェクトの CRUD(仕様書 §5.3/§5.5)。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import Drawing, TradeSession
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.drawing import (
    CreateDrawingRequest,
    DrawingResponse,
    UpdateDrawingRequest,
)

router = APIRouter(tags=["drawings"])


def _to_response(d: Drawing) -> DrawingResponse:
    return DrawingResponse(
        id=d.id,
        session_id=d.session_id,
        kind=d.kind,
        data=d.data,
        label=d.label,
        symbol=d.symbol,
        timeframe=d.timeframe,
        visible_on_timeframes=list(d.visible_on_timeframes) if d.visible_on_timeframes else None,
    )


@router.get("/sessions/{session_id}/drawings", response_model=list[DrawingResponse])
def list_drawings(
    session_id: str,
    symbol: str | None = None,
    db: Session = Depends(get_db),
) -> list[DrawingResponse]:
    """仕様書 §5.3 / §6.1 統合フロー: symbol が指定されたら該当銘柄の描画のみ返す。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    stmt = select(Drawing).where(Drawing.session_id == session_id)
    if symbol:
        stmt = stmt.where(Drawing.symbol == symbol.upper())
    rows = db.scalars(stmt).all()
    return [_to_response(d) for d in rows]


@router.post("/sessions/{session_id}/drawings", response_model=DrawingResponse, status_code=201)
def create_drawing(
    session_id: str,
    body: CreateDrawingRequest,
    db: Session = Depends(get_db),
) -> DrawingResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    d = Drawing(
        session_id=session_id,
        symbol=body.symbol.upper() if body.symbol else None,
        kind=body.kind,
        data=body.data,
        label=body.label,
        timeframe=body.timeframe,
        visible_on_timeframes=body.visible_on_timeframes,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return _to_response(d)


@router.patch("/drawings/{drawing_id}", response_model=DrawingResponse)
def update_drawing(
    drawing_id: int,
    body: UpdateDrawingRequest,
    db: Session = Depends(get_db),
) -> DrawingResponse:
    d = db.get(Drawing, drawing_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Drawing not found")
    if body.data is not None:
        d.data = body.data
    if body.label is not None:
        d.label = body.label
    if body.visible_on_timeframes is not None:
        d.visible_on_timeframes = body.visible_on_timeframes
    db.commit()
    db.refresh(d)
    return _to_response(d)


@router.delete("/drawings/{drawing_id}", status_code=204)
def delete_drawing(drawing_id: int, db: Session = Depends(get_db)) -> None:
    d = db.get(Drawing, drawing_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Drawing not found")
    db.delete(d)
    db.commit()
