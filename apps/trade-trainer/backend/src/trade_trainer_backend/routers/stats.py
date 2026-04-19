"""基本成績集計エンドポイント(仕様書 Phase 1)。"""
from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import Trade, TradingStyle
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.stats import StatsSummaryResponse, StyleStatsRow

router = APIRouter(prefix="/stats", tags=["stats"])


def _compute_stats(trades: list[Trade]) -> dict[str, float | int]:
    """Trade のリストから基本統計値を計算するヘルパー。"""
    total = len(trades)
    if total == 0:
        return {
            "total_trades": 0, "win_count": 0, "loss_count": 0,
            "win_rate": 0.0, "total_pips": 0.0, "avg_pips_per_trade": 0.0,
            "profit_factor": 0.0,
        }
    wins = [t for t in trades if (t.pips_pnl or 0) > 0]
    losses = [t for t in trades if (t.pips_pnl or 0) < 0]
    total_pips = sum(t.pips_pnl or 0 for t in trades)
    gain = sum(t.pips_pnl for t in wins)
    loss_abs = abs(sum(t.pips_pnl for t in losses))
    return {
        "total_trades": total,
        "win_count": len(wins),
        "loss_count": len(losses),
        "win_rate": round(len(wins) / total, 4),
        "total_pips": round(total_pips, 1),
        "avg_pips_per_trade": round(total_pips / total, 1),
        "profit_factor": round(gain / loss_abs, 2) if loss_abs > 0 else 0.0,
    }


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

    trades = list(db.scalars(stmt).all())
    return StatsSummaryResponse(**_compute_stats(trades))


@router.get("/by-style", response_model=list[StyleStatsRow])
def get_stats_by_style(db: Session = Depends(get_db)) -> list[StyleStatsRow]:
    """スタイル別の成績を集計する(仕様書 §10.3)。トレード数が多い順に返す。"""
    stmt = select(Trade).where(
        Trade.mode == "training",
        Trade.exit_time.is_not(None),
        Trade.pips_pnl.is_not(None),
    )
    trades = list(db.scalars(stmt).all())

    # スタイル id → Trade のリスト
    groups: dict[str | None, list[Trade]] = defaultdict(list)
    for t in trades:
        groups[t.style_id].append(t)

    # スタイルマスタを id でインデックス化
    styles = {s.id: s for s in db.scalars(select(TradingStyle)).all()}

    rows: list[StyleStatsRow] = []
    for style_id, ts in groups.items():
        stats = _compute_stats(ts)
        style = styles.get(style_id) if style_id else None
        rows.append(
            StyleStatsRow(
                style_id=style_id,
                style_name=style.name if style else (style_id or "(未選択)"),
                primary_timeframe=style.primary_timeframe if style else None,
                **stats,  # type: ignore[arg-type]
            )
        )
    rows.sort(key=lambda r: r.total_trades, reverse=True)
    return rows
