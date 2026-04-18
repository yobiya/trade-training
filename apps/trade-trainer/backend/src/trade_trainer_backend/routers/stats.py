"""基本成績集計エンドポイント(仕様書 Phase 1)。"""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import Trade
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.stats import StatsSummaryResponse

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/summary", response_model=StatsSummaryResponse)
def get_summary(
    symbol: str | None = None,
    db: Session = Depends(get_db),
) -> StatsSummaryResponse:
    """トレーニングの基本成績を集計して返す。"""
    stmt = select(Trade).where(
        Trade.mode == "training",
        Trade.exit_time.is_not(None),
        Trade.pips_pnl.is_not(None),
    )
    if symbol:
        stmt = stmt.where(Trade.symbol == symbol.upper())

    trades = db.scalars(stmt).all()

    if not trades:
        return StatsSummaryResponse(
            total_trades=0,
            win_count=0,
            loss_count=0,
            win_rate=0.0,
            total_pips=0.0,
            avg_pips_per_trade=0.0,
            profit_factor=0.0,
        )

    wins = [t for t in trades if (t.pips_pnl or 0) > 0]
    losses = [t for t in trades if (t.pips_pnl or 0) < 0]
    total_pips = sum(t.pips_pnl or 0 for t in trades)
    gain = sum(t.pips_pnl for t in wins)
    loss_abs = abs(sum(t.pips_pnl for t in losses))
    profit_factor = round(gain / loss_abs, 2) if loss_abs > 0 else 0.0

    return StatsSummaryResponse(
        total_trades=len(trades),
        win_count=len(wins),
        loss_count=len(losses),
        win_rate=round(len(wins) / len(trades), 4) if trades else 0.0,
        total_pips=round(total_pips, 1),
        avg_pips_per_trade=round(total_pips / len(trades), 1),
        profit_factor=profit_factor,
    )
