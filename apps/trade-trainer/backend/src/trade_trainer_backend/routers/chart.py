"""チャートデータ・足送りエンドポイント。"""
import uuid
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, HTTPException

from trade_trainer_backend.schemas.chart import AdvanceResponse, ChartResponse, OhlcBar
from trade_trainer_backend.services import session_store

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


def _check_sl_tp(trade, bars: pd.DataFrame) -> tuple[str, float] | None:  # type: ignore[no-untyped-def]
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
    before: datetime | None = None,  # 指定時は before より前の bars 本を返す(遅延ロード用)
    symbol: str | None = None,  # 銘柄選定中は任意銘柄のチャートを取得するために指定(§6.1)
) -> ChartResponse:
    agg = session_store.load(session_id)
    if agg is None:
        raise HTTPException(status_code=404, detail="Session not found")

    cp = agg.meta.current_position
    current_pos = cp if cp.tzinfo is not None else cp.replace(tzinfo=timezone.utc)
    from market_data.timeframes import TIMEFRAME_MINUTES

    if timeframe not in TIMEFRAME_MINUTES:
        raise HTTPException(status_code=400, detail=f"Invalid timeframe: {timeframe}")

    tf_minutes = TIMEFRAME_MINUTES[timeframe]

    # 右端の決定: before 指定時は before より前(排他)の N 本を返す。
    # current_position を越える未来は露出しない。
    if before is not None:
        before_utc = before.replace(tzinfo=timezone.utc) if before.tzinfo is None else before.astimezone(timezone.utc)
        # 排他にするため、1 timeframe 分手前を上限にする
        to_dt = before_utc - timedelta(minutes=tf_minutes)
        if to_dt > current_pos:
            to_dt = current_pos
    else:
        to_dt = current_pos

    # 統合フロー(§6.1): symbol はフロントが必ず指定する。
    # 未指定のフォールバックはエントリー済 Trade.symbol のみ(後方互換)。
    if symbol:
        symbol = symbol.upper()
    else:
        if agg.trade is None:
            raise HTTPException(status_code=400, detail="symbol query required in analyzing phase")
        symbol = agg.trade.symbol

    from market_data.accessor import get_ohlc

    # 週末・祝日・データ欠損に備え、目標本数に達するまで指数的に from_dt を遡る。
    # 最大で ~18 倍(週末 2 日を数回跨いでも賄える範囲)まで拡張する。
    # market-data が例外を投げるケース(MT5 未接続・プロバイダー異常)も空データ扱いにする。
    max_multiplier = 32
    multiplier = 1
    df = None
    last_error: Exception | None = None
    while multiplier <= max_multiplier:
        fetch_minutes = bars * tf_minutes * multiplier + _BARS_FETCH_BUFFER * tf_minutes
        from_dt = to_dt - timedelta(minutes=fetch_minutes)
        try:
            df = get_ohlc(symbol, timeframe, from_dt, to_dt)
        except Exception as e:  # noqa: BLE001 — プロバイダー由来の例外を握りつぶして空扱いにする
            last_error = e
            df = None
        if df is not None and len(df) >= bars:
            break
        multiplier *= 2

    if df is None:
        try:
            df = get_ohlc(symbol, timeframe, to_dt - timedelta(minutes=tf_minutes), to_dt)
        except Exception as e:  # noqa: BLE001
            last_error = e
            df = None

    # データが全く取れなかった場合(キャッシュ未ヒット・MT5 未接続・週末長期休場など)は
    # 空 bars で返す。500 を返すとフロントで動作が止まるため、UI 側で「データなし」を扱わせる。
    if df is None or len(df) == 0:
        if last_error is not None:
            import logging
            logging.getLogger(__name__).warning(
                "get_ohlc failed for %s %s (session=%s): %s",
                symbol, timeframe, session_id, last_error,
            )
        return ChartResponse(bars=[], current_position=current_pos, timeframe=timeframe)

    df = df.tail(bars)

    return ChartResponse(
        bars=_df_to_bars(df),
        current_position=current_pos,
        timeframe=timeframe,
    )


@router.post("/sessions/{session_id}/advance", response_model=AdvanceResponse)
def advance_session(session_id: str, bars: int = 1) -> AdvanceResponse:
    """足を N 本進める。SL/TP ヒット時は自動決済する。"""
    agg = session_store.load(session_id)
    if agg is None:
        raise HTTPException(status_code=404, detail="Session not found")

    cp = agg.meta.current_position
    current_pos = cp if cp.tzinfo is not None else cp.replace(tzinfo=timezone.utc)
    new_pos = current_pos + timedelta(minutes=5 * bars)

    auto_closed = False
    exit_reason = None
    exit_price = None
    pips_pnl = None
    new_m5_bars: list[OhlcBar] = []

    # 統合フロー(§6.1): 保有中(エントリー済 + 未決済)のみ自動決済チェック
    trade = agg.trade if agg.trade is not None and agg.trade.exit_time is None else None

    if trade is not None:
        from market_data.accessor import get_ohlc
        symbol = trade.symbol
        new_m5 = get_ohlc(symbol, "M5", current_pos + timedelta(minutes=5), new_pos)

        if not new_m5.empty:
            hit = _check_sl_tp(trade, new_m5)
            if hit:
                exit_reason, exit_price = hit
                pips_pnl = _calculate_pips(symbol, trade.direction, trade.entry_price, exit_price)
                trade.exit_time = new_pos
                trade.exit_price = exit_price
                trade.exit_reason = exit_reason
                trade.pips_pnl = pips_pnl
                session_store.save_trade(session_id, trade)
                auto_closed = True
            new_m5_bars = _df_to_bars(new_m5)

    agg.meta.current_position = new_pos
    session_store.save_meta(agg.meta)

    return AdvanceResponse(
        new_bars=new_m5_bars,
        current_position=new_pos,
        trade_auto_closed=auto_closed,
        trade_exit_reason=exit_reason,
        trade_exit_price=exit_price,
        trade_pips_pnl=pips_pnl,
    )
