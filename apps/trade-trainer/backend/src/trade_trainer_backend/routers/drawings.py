"""描画オブジェクトの CRUD(仕様書 §5.3/§5.5、ver 1.45 でファイル管理化)。

drawings は `data/sessions/{dir}/drawings.json` に配列として保存。
PATCH / DELETE は session_id を path に含めて該当セッションのファイルのみを書き換える。
"""
from fastapi import APIRouter

from trade_trainer_backend.routers._helpers import ensure_session
from trade_trainer_backend.schemas.drawing import (
    CreateDrawingRequest,
    DrawingResponse,
    UpdateDrawingRequest,
)
from trade_trainer_backend.services import session_store
from trade_trainer_backend.services.session_models import Drawing
from trade_trainer_backend.utils.http import not_found

router = APIRouter(tags=["drawings"])


def _to_response(session_id: str, d: Drawing) -> DrawingResponse:
    return DrawingResponse(
        id=d.id,
        session_id=session_id,
        kind=d.kind,
        data=d.data,
        label=d.label,
        symbol=d.symbol,
        timeframe=d.timeframe,
        visible_on_timeframes=list(d.visible_on_timeframes) if d.visible_on_timeframes else None,
    )


@router.get("/sessions/{session_id}/drawings", response_model=list[DrawingResponse])
def list_drawings(session_id: str, symbol: str | None = None) -> list[DrawingResponse]:
    """§5.3 / §6.1 統合フロー: symbol 指定で該当銘柄のみ返す。"""
    agg = ensure_session(session_id)
    rows = agg.drawings
    if symbol:
        sym = symbol.upper()
        rows = [d for d in rows if d.symbol == sym]
    return [_to_response(session_id, d) for d in rows]


@router.post("/sessions/{session_id}/drawings", response_model=DrawingResponse, status_code=201)
def create_drawing(session_id: str, body: CreateDrawingRequest) -> DrawingResponse:
    agg = ensure_session(session_id)
    new_id = max((d.id for d in agg.drawings), default=0) + 1
    new = Drawing(
        id=new_id,
        symbol=body.symbol.upper() if body.symbol else None,
        kind=body.kind,
        data=body.data,
        label=body.label,
        timeframe=body.timeframe,
        visible_on_timeframes=body.visible_on_timeframes,
    )
    agg.drawings.append(new)
    session_store.save_drawings(session_id, agg.drawings)
    return _to_response(session_id, new)


@router.patch("/sessions/{session_id}/drawings/{drawing_id}", response_model=DrawingResponse)
def update_drawing(
    session_id: str,
    drawing_id: int,
    body: UpdateDrawingRequest,
) -> DrawingResponse:
    agg = ensure_session(session_id)
    target: Drawing | None = None
    for d in agg.drawings:
        if d.id == drawing_id:
            target = d
            break
    if target is None:
        raise not_found("Drawing not found")
    if body.data is not None:
        target.data = body.data
    if body.label is not None:
        target.label = body.label
    if body.visible_on_timeframes is not None:
        target.visible_on_timeframes = body.visible_on_timeframes
    session_store.save_drawings(session_id, agg.drawings)
    return _to_response(session_id, target)


@router.delete("/sessions/{session_id}/drawings/{drawing_id}", status_code=204)
def delete_drawing(session_id: str, drawing_id: int) -> None:
    agg = ensure_session(session_id)
    new_list = [d for d in agg.drawings if d.id != drawing_id]
    if len(new_list) == len(agg.drawings):
        raise not_found("Drawing not found")
    session_store.save_drawings(session_id, new_list)
