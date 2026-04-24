"""経済指標エンドポイント(仕様書 §5.4)。

セッションの期間・通貨・重要度で絞り込んで返す。
`event_time > session.current_position` の場合は訓練価値保全のため
actual / surprise を null にマスクする(実戦で事前に知れない情報を伏せる)。
"""
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.market import EconomicEvent
from shared_schema.models.trading import TradeSession
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.event import EconomicEventResponse

router = APIRouter(tags=["events"])


def _parse_currencies(raw: str | None) -> list[str] | None:
    if not raw:
        return None
    parts = [p.strip().upper() for p in raw.split(",") if p.strip()]
    return parts or None


@router.get("/sessions/{session_id}/events", response_model=list[EconomicEventResponse])
def list_events(
    session_id: str,
    from_: Annotated[datetime, Query(alias="from")],
    to: datetime,
    currencies: Annotated[str | None, Query(description="通貨コードのカンマ区切り(未指定=全通貨)")] = None,
    importance_min: int = 3,
    db: Session = Depends(get_db),
) -> list[EconomicEventResponse]:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    from_utc = from_.astimezone(timezone.utc).replace(tzinfo=None) if from_.tzinfo else from_
    to_utc = to.astimezone(timezone.utc).replace(tzinfo=None) if to.tzinfo else to
    current_pos = s.current_position  # naive UTC

    stmt = (
        select(EconomicEvent)
        .where(
            EconomicEvent.event_time >= from_utc,
            EconomicEvent.event_time <= to_utc,
            EconomicEvent.importance >= importance_min,
        )
        .order_by(EconomicEvent.event_time)
    )

    currency_list = _parse_currencies(currencies)
    if currency_list:
        stmt = stmt.where(EconomicEvent.currency.in_(currency_list))

    rows = db.scalars(stmt).all()

    # 未来の発表は actual/surprise をマスクする(訓練価値保全)
    result: list[EconomicEventResponse] = []
    for r in rows:
        is_future = r.event_time > current_pos
        result.append(EconomicEventResponse(
            id=r.id,
            event_time=r.event_time.replace(tzinfo=timezone.utc),
            currency=r.currency,
            name=r.name,
            importance=r.importance,
            actual=None if is_future else r.actual,
            forecast=r.forecast,
            previous=r.previous,
            surprise=None if is_future else r.surprise,
        ))
    return result
