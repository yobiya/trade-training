"""チャートデータ・足送りエンドポイント。"""
import uuid
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import SessionFinalDecision, Trade, TradeSession
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.chart import AdvanceResponse, ChartResponse, OhlcBar

router = APIRouter(tags=["chart"])

_DEFAULT_BARS = 200
_BARS_FETCH_BUFFER = 10  # 上位足リサンプリングのためのバッファ係数


def _df_to_bars(df: pd.DataFrame) -> list[OhlcBar]:
    bars = []
    for ts, row in df.iterrows():
        if hasattr(ts, "timestamp"):
            unix_ts = int(ts.timestamp())
        else:
            unix_ts = int(ts)
        bars.append(
            OhlcBar(
                t=unix_ts,
                o=float(row["open"]),
                h=float(row["high"]),
                l=float(row["low"]),
                c=float(row["close"]),
                v=int(row["volume"]),
            )
        )
    return bars


def _calculate_pips(symbol: str, direction: str, entry: float, exit_price: float) -> float:
    pip_size = 0.01 if symbol.upper().endswith("JPY") else 0.0001
    diff = (exit_price - entry) if direction == "buy" else (entry - exit_price)
    return round(diff / pip_size, 1)


def _check_sl_tp(trade: Trade, bars: pd.DataFrame) -> tuple[str, float] | None:
    """各バーで SL/TP がヒットしたか順番にチェックする。"""
    for _, bar in bars.iterrows():
        if trade.direction == "buy":
            if trade.sl is not None and bar["low"] <= trade.sl:
                return ("sl", float(trade.sl))
            if trade.tp is not None and bar["high"] >= trade.tp:
                return ("tp", float(trade.tp))
        else:
            if trade.sl is not None and bar["high"] >= trade.sl:
                return ("sl", float(trade.sl))
            if trade.tp is not None and bar["low"] <= trade.tp:
                return ("tp", float(trade.tp))
    return None


@router.get("/sessions/{session_id}/chart", response_model=ChartResponse)
def get_chart(
    session_id: str,
    timeframe: str = "M5",
    bars: int = _DEFAULT_BARS,
    db: Session = Depends(get_db),
) -> ChartResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    current_pos = s.current_position.replace(tzinfo=timezone.utc)
    from market_data.timeframes import TIMEFRAME_MINUTES, timeframe_delta

    if timeframe not in TIMEFRAME_MINUTES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    tf_minutes = TIMEFRAME_MINUTES[timeframe]
    fetch_bars_m5 = bars * tf_minutes + _BARS_FETCH_BUFFER * tf_minutes
    from_dt = current_pos - timedelta(minutes=fetch_bars_m5)

    fd = db.get(SessionFinalDecision, session_id)
    symbol = fd.symbol if fd else "USDJPY"

    from market_data.accessor import get_ohlc
    df = get_ohlc(symbol, timeframe, from_dt, current_pos)
    df = df.tail(bars)

    return ChartResponse(
        bars=_df_to_bars(df),
        current_position=current_pos,
        timeframe=timeframe,
    )


@router.post("/sessions/{session_id}/advance", response_model=AdvanceResponse)
def advance_session(
    session_id: str,
    bars: int = 1,
    db: Session = Depends(get_db),
) -> AdvanceResponse:
    """足を N 本進める。SL/TP ヒット時は自動決済する。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    current_pos = s.current_position.replace(tzinfo=timezone.utc)
    new_pos = current_pos + timedelta(minutes=5 * bars)

    fd = db.get(SessionFinalDecision, session_id)
    symbol = fd.symbol if fd else "USDJPY"

    # 新しい M5 バーを取得(SL/TP チェック用)
    from market_data.accessor import get_ohlc
    new_m5 = get_ohlc(symbol, "M5", current_pos + timedelta(minutes=5), new_pos)

    # アクティブなトレードの SL/TP チェック
    trade = db.scalars(
        select(Trade).where(Trade.session_id == session_id, Trade.exit_time.is_(None))
    ).first()

    auto_closed = False
    exit_reason = None
    exit_price = None
    pips_pnl = None

    if trade is not None and not new_m5.empty:
        hit = _check_sl_tp(trade, new_m5)
        if hit:
            exit_reason, exit_price = hit
            pips_pnl = _calculate_pips(symbol, trade.direction, trade.entry_price, exit_price)
            trade.exit_time = new_pos.replace(tzinfo=None)
            trade.exit_price = exit_price
            trade.exit_reason = exit_reason
            trade.pips_pnl = pips_pnl
            auto_closed = True
            # SessionFinalDecision の has_entry を True に更新
            if fd:
                fd.has_entry = True

    s.current_position = new_pos.replace(tzinfo=None)
    db.commit()

    return AdvanceResponse(
        new_bars=_df_to_bars(new_m5),
        current_position=new_pos,
        trade_auto_closed=auto_closed,
        trade_exit_reason=exit_reason,
        trade_exit_price=exit_price,
        trade_pips_pnl=pips_pnl,
    )
