"""仕様書 §11.3 AI 送信データを組み立てるビルダー(セッションファイルから読み込む)。

画像(§11.3.1)はフロント側で lightweight-charts から書き出すため本モジュールには含めない。
ここでは判断時点メタ・事後結果(R 単位)・メモ・経済指標・インジ設定・描画サマリを
1 つの payload に束ねて返す。プレビュー・実 API 送信のどちらからも同じデータを使う。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from shared_schema.models.market import EconomicEvent
from trade_trainer_backend.schemas.ai_analysis import (
    AIAnalysisPayload,
    DecisionMeta,
    DrawingSummary,
    EconomicEventSummary,
    EntryResult,
    IndicatorSnapshot,
    Layer1Candidate,
    MemoBlock,
    StageEvalOut,
)
from trade_trainer_backend.services import session_store
from trade_trainer_backend.services.session_models import (
    Candidate,
    SessionAggregate,
    Trade,
)
from trade_trainer_backend.services.post_eval import (
    _trade_pip_size,
    evaluate_entry,
    evaluate_symbol,
    resolve_trade_r_unit_pips,
)


# 判断時刻前後で経済指標を拾う幅(時間)
ECONOMIC_EVENT_WINDOW_HOURS: int = 24


AnalysisMode = Literal["decision", "review"]


# --------------------------------------------------------------------------- #
# ヘルパー
# --------------------------------------------------------------------------- #

def _utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _determine_mode(trade: Trade | None) -> AnalysisMode:
    """Trade の状態から analysis_mode を導出する。

    - Trade あり + 決済済み: review
    - それ以外(未エントリー / 保有中): decision

    保有中に review を無理に出すと「保有中に事後情報を見せる」になるため decision 扱い。
    """
    if trade is not None and trade.exit_time is not None:
        return "review"
    return "decision"


def _build_decision_meta(agg: SessionAggregate) -> DecisionMeta:
    if agg.trade is not None:
        trade_r = resolve_trade_r_unit_pips(agg.trade)
        return DecisionMeta(
            decision_type="entry",
            session_mode=agg.meta.mode,
            symbol=agg.trade.symbol,
            decision_time=_utc(agg.trade.entry_time),
            decision_price=agg.trade.entry_price,
            direction=agg.trade.direction,  # type: ignore[arg-type]
            sl_price=agg.trade.sl,
            tp_price=agg.trade.tp,
            r_unit_pips=trade_r,
            r_unit_source="trade_sl" if trade_r is not None else "unresolved",
        )

    # 見送り(またはまだ判断前)。SL 未確定のため R 基準は持たない。
    return DecisionMeta(
        decision_type="skip",
        session_mode=agg.meta.mode,
        symbol=None,
        decision_time=_utc(agg.meta.presented_at),
        decision_price=None,
        direction=None,
        sl_price=None,
        tp_price=None,
        r_unit_pips=None,
        r_unit_source="unresolved",
    )


def _build_entry_result(trade: Trade) -> EntryResult | None:
    """決済済み trade から §9.5 の事後結果を組み立てる。未決済なら None。"""
    if trade.exit_time is None or trade.exit_price is None:
        return None
    obs = evaluate_entry(trade)
    entry_time = _utc(trade.entry_time)
    exit_time = _utc(trade.exit_time)
    hold_minutes = int((exit_time - entry_time).total_seconds() / 60)

    psize = _trade_pip_size(trade)
    actual_sl_pips = (
        abs(float(trade.entry_price) - float(trade.sl)) / psize
        if trade.sl is not None else None
    )
    actual_tp_pips = (
        abs(float(trade.entry_price) - float(trade.tp)) / psize
        if trade.tp is not None else None
    )

    return EntryResult(
        exit_time=exit_time,
        exit_price=trade.exit_price,
        hold_minutes=hold_minutes,
        actual_sl_pips=round(actual_sl_pips, 1) if actual_sl_pips is not None else None,
        actual_tp_pips=round(actual_tp_pips, 1) if actual_tp_pips is not None else None,
        mfe_r=obs.mfe_r,
        mae_r=obs.mae_r,
        mfe_pips=obs.mfe_pips,
        mae_pips=obs.mae_pips,
        r_pnl=obs.r_pnl,
        continuation_bars=obs.continuation_bars,
        continuation_available=obs.continuation_available,
    )


def _build_memos(
    agg: SessionAggregate,
    layer1: list[Layer1Candidate],
) -> MemoBlock:
    # エントリー銘柄の銘柄別メモ
    symbol_memo: str | None = None
    if agg.trade is not None:
        for c in agg.candidates:
            if c.symbol == agg.trade.symbol:
                symbol_memo = c.memo
                break

    return MemoBlock(
        session_note=agg.note,
        symbol_memo=symbol_memo,
        layer1_memos=layer1,
    )


def _build_layer1(
    agg: SessionAggregate,
    skip_r_unit: float | None,
    analysis_mode: AnalysisMode,
) -> list[Layer1Candidate]:
    """層 1 非エントリー候補に対して事後 pips/R を計算して返す。"""
    pa = agg.meta.presented_at
    ref_dt = pa if pa.tzinfo else pa.replace(tzinfo=timezone.utc)
    selected_symbol = agg.trade.symbol if agg.trade is not None else None

    from market_data.accessor import get_symbol_digits, get_symbol_point
    from trade_trainer_backend.services.symbols import derive_pip_size

    result: list[Layer1Candidate] = []
    for c in agg.candidates:
        if selected_symbol is not None and c.symbol == selected_symbol:
            continue

        if analysis_mode == "review":
            cand_pip = derive_pip_size(get_symbol_point(c.symbol), get_symbol_digits(c.symbol), c.symbol)
            rv = evaluate_symbol(c.symbol, ref_dt, r_unit_pips=skip_r_unit, pip_size_override=cand_pip)
            stages = [
                StageEvalOut(
                    bars=st.bars,
                    max_up_pips=st.max_up_pips,
                    max_down_pips=st.max_down_pips,
                    max_up_r=st.max_up_r,
                    max_down_r=st.max_down_r,
                )
                for st in rv.stages
            ]
            ref_price = rv.ref_price
        else:
            stages = []
            ref_price = None

        result.append(Layer1Candidate(
            symbol=c.symbol,
            memo=c.memo,
            stages=stages,
            ref_price=ref_price,
        ))
    return result


def _build_drawings(agg: SessionAggregate) -> list[DrawingSummary]:
    result: list[DrawingSummary] = []
    for d in agg.drawings:
        note: str | None = None
        if d.kind == "wave_label":
            wave = (d.data or {}).get("wave") if isinstance(d.data, dict) else None
            if wave is not None:
                note = f"wave={wave}"
        result.append(DrawingSummary(
            kind=d.kind,
            timeframe=d.timeframe,
            symbol=d.symbol,
            label=d.label,
            note=note,
        ))
    return result


def _build_economic_events(
    decision_time: datetime,
    symbol: str | None,
    db: OrmSession,
) -> list[EconomicEventSummary]:
    """判断時刻 ±N 時間の経済指標を取得。"""
    from_dt = decision_time - timedelta(hours=ECONOMIC_EVENT_WINDOW_HOURS)
    to_dt = decision_time + timedelta(hours=ECONOMIC_EVENT_WINDOW_HOURS)
    from_naive = from_dt.replace(tzinfo=None)
    to_naive = to_dt.replace(tzinfo=None)

    currencies: set[str] = {"USD"}
    if symbol and len(symbol) >= 6:
        currencies.add(symbol[:3].upper())
        currencies.add(symbol[3:6].upper())

    stmt = (
        select(EconomicEvent)
        .where(
            EconomicEvent.event_time >= from_naive,
            EconomicEvent.event_time <= to_naive,
            EconomicEvent.currency.in_(list(currencies)),
        )
        .order_by(EconomicEvent.event_time)
    )
    rows = db.scalars(stmt).all()

    # 判断時点分析では「判断時刻以降の実測値」は未来情報なのでマスク
    result: list[EconomicEventSummary] = []
    for r in rows:
        evt_time_utc = r.event_time.replace(tzinfo=timezone.utc) if r.event_time.tzinfo is None else r.event_time
        is_future = evt_time_utc > decision_time
        result.append(EconomicEventSummary(
            event_time=evt_time_utc,
            currency=r.currency,
            name=r.name,
            importance=r.importance,
            actual=None if is_future else r.actual,
            forecast=r.forecast,
            previous=r.previous,
            surprise=None if is_future else r.surprise,
        ))
    return result


# --------------------------------------------------------------------------- #
# 公開 API
# --------------------------------------------------------------------------- #

def build_ai_analysis_input(
    session_id: str,
    db: OrmSession,
    analysis_mode: AnalysisMode | None = None,
) -> AIAnalysisPayload:
    """指定セッションから §11.3 の AI 送信 payload を組み立てる。

    analysis_mode=None なら Trade 状態から自動判定(決済済み→review、それ以外→decision)。
    db は経済指標(SQLite 維持)取得のため引き続き必要。
    """
    agg = session_store.load(session_id)
    if agg is None:
        raise HTTPException(status_code=404, detail="Session not found")

    mode: AnalysisMode = analysis_mode or _determine_mode(agg.trade)

    decision = _build_decision_meta(agg)

    entry_result: EntryResult | None = None
    if mode == "review" and agg.trade is not None:
        entry_result = _build_entry_result(agg.trade)

    layer1 = _build_layer1(agg, decision.r_unit_pips, mode)
    memos = _build_memos(agg, layer1)

    indicators: list[IndicatorSnapshot] = []  # §11.8 未実装

    drawings = _build_drawings(agg)
    events = _build_economic_events(decision.decision_time, decision.symbol, db)

    return AIAnalysisPayload(
        analysis_mode=mode,
        session_id=session_id,
        session_mode=agg.meta.mode,
        decision=decision,
        entry_result=entry_result,
        memos=memos,
        indicators=indicators,
        drawings=drawings,
        economic_events=events,
        layer1_candidates=layer1,
        generated_at=datetime.now(timezone.utc),
    )
