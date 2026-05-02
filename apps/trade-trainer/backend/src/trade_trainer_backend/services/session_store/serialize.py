"""dataclass ↔ dict 変換層(2026-04-29 で session_store.py から分離)。

純粋な変換のみ。file I/O は io.py、orchestration は __init__.py に集約。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from trade_trainer_backend.services.session_models import (
    Drawing,
    FinalDecision,
    HoldingMemo,
    SessionAggregate,
    SessionMeta,
    Trade,
)
from trade_trainer_backend.utils.datetime import parse_iso_datetime


def _opt_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ----- Trade -----

def trade_from_dict(data: Any) -> Trade | None:
    if not isinstance(data, dict):
        return None
    return Trade(
        id=data.get("id", ""),
        symbol=data.get("symbol", ""),
        direction=data.get("direction", "buy"),
        entry_tf=data.get("entry_tf", "M5"),  # 旧データに entry_tf が無ければ M5 で読む
        entry_time=parse_iso_datetime(data.get("entry_time")) or datetime.now(timezone.utc),
        entry_price=float(data.get("entry_price", 0)),
        sl=_opt_float(data.get("sl")),
        tp=_opt_float(data.get("tp")),
        exit_time=parse_iso_datetime(data.get("exit_time")),
        exit_price=_opt_float(data.get("exit_price")),
        exit_reason=data.get("exit_reason"),
        pips_pnl=_opt_float(data.get("pips_pnl")),
        amount_pnl=_opt_float(data.get("amount_pnl")),
        lot=_opt_float(data.get("lot")),
        mt5_order_id=data.get("mt5_order_id"),
        created_at=parse_iso_datetime(data.get("created_at")) or datetime.now(timezone.utc),
    )


def trade_to_dict(t: Trade) -> dict[str, Any]:
    return {
        "id": t.id,
        "symbol": t.symbol,
        "direction": t.direction,
        "entry_tf": t.entry_tf,
        "entry_time": t.entry_time,
        "entry_price": t.entry_price,
        "sl": t.sl,
        "tp": t.tp,
        "exit_time": t.exit_time,
        "exit_price": t.exit_price,
        "exit_reason": t.exit_reason,
        "pips_pnl": t.pips_pnl,
        "amount_pnl": t.amount_pnl,
        "lot": t.lot,
        "mt5_order_id": t.mt5_order_id,
        "created_at": t.created_at,
    }


# ----- FinalDecision -----

def fd_from_dict(data: Any) -> FinalDecision | None:
    if not isinstance(data, dict):
        return None
    return FinalDecision(
        has_entry=bool(data.get("has_entry", False)),
        skip_reason=data.get("skip_reason"),
    )


def fd_to_dict(fd: FinalDecision) -> dict[str, Any]:
    return {"has_entry": fd.has_entry, "skip_reason": fd.skip_reason}


# ----- Drawing -----

def drawing_from_dict(item: Any) -> Drawing | None:
    if not isinstance(item, dict):
        return None
    return Drawing(
        id=int(item.get("id", 0)),
        symbol=item.get("symbol"),
        kind=item.get("kind", ""),
        data=item.get("data", {}) or {},
        label=item.get("label"),
        timeframe=item.get("timeframe"),
        visible_on_timeframes=item.get("visible_on_timeframes"),
    )


def drawing_to_dict(d: Drawing) -> dict[str, Any]:
    return {
        "id": d.id,
        "symbol": d.symbol,
        "kind": d.kind,
        "data": d.data,
        "label": d.label,
        "timeframe": d.timeframe,
        "visible_on_timeframes": d.visible_on_timeframes,
    }


# ----- HoldingMemo -----

def holding_memo_from_dict(rec: Any) -> HoldingMemo | None:
    if not isinstance(rec, dict):
        return None
    ts = parse_iso_datetime(rec.get("timestamp"))
    memo = rec.get("memo")
    if ts is None or not isinstance(memo, str):
        return None
    return HoldingMemo(timestamp=ts, memo=memo)


def holding_memo_to_dict(m: HoldingMemo) -> dict[str, Any]:
    return {"timestamp": m.timestamp, "memo": m.memo}


# ----- SessionMeta -----

def meta_from_dict(data: dict[str, Any]) -> SessionMeta | None:
    sid = data.get("id")
    presented_at = parse_iso_datetime(data.get("presented_at"))
    started_at = parse_iso_datetime(data.get("started_at"))
    current_position = parse_iso_datetime(data.get("current_position"))
    mode = data.get("mode")
    if not all([sid, presented_at, started_at, current_position, mode]):
        return None
    return SessionMeta(
        id=sid,                                                       # type: ignore[arg-type]
        name=data.get("name"),
        started_at=started_at,                                         # type: ignore[arg-type]
        presented_at=presented_at,                                     # type: ignore[arg-type]
        current_position=current_position,                             # type: ignore[arg-type]
        mode=mode,                                                     # type: ignore[arg-type]
        settled_at=parse_iso_datetime(data.get("settled_at")),
        indicator_config_id=data.get("indicator_config_id"),
    )


def meta_to_dict(meta: SessionMeta) -> dict[str, Any]:
    return {
        "id": meta.id,
        "name": meta.name,
        "started_at": meta.started_at,
        "presented_at": meta.presented_at,
        "current_position": meta.current_position,
        "mode": meta.mode,
        "settled_at": meta.settled_at,
        "indicator_config_id": meta.indicator_config_id,
    }


# ----- SessionAggregate (整合形式) -----

def aggregate_to_session_dict(agg: SessionAggregate) -> dict[str, Any]:
    """SessionAggregate を session.json のシリアライズ形式に変換。"""
    base = meta_to_dict(agg.meta)
    base["trade"] = trade_to_dict(agg.trade) if agg.trade is not None else None
    base["final_decision"] = fd_to_dict(agg.final_decision) if agg.final_decision is not None else None
    base["drawings"] = [drawing_to_dict(d) for d in agg.drawings]
    base["holding_memos"] = [holding_memo_to_dict(m) for m in agg.holding_memos]
    return base
