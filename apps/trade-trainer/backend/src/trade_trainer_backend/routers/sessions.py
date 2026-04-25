"""セッション管理エンドポイント(ver 1.45 でファイル管理化)。

セッションは `data/sessions/{dir}/` 単位で永続化。
DB は使わず、SessionStore (`services/session_store.py`) 経由で読み書きする。
"""
import random
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from trade_trainer_backend.config import Settings, get_settings
from trade_trainer_backend.schemas.post_review import (
    CandidateReview,
    EntryReview,
    PostReviewResponse,
    SkipReview,
    StageEvalResp,
)
from trade_trainer_backend.schemas.session import (
    CandidateResponse,
    CreateCandidateRequest,
    CreateSessionRequest,
    SessionListItem,
    SessionResponse,
    SkipSessionRequest,
    UpdateCandidateRequest,
    UpdateNoteRequest,
    UpdateSessionNameRequest,
)
from trade_trainer_backend.services import session_store
from trade_trainer_backend.services.session_models import (
    Candidate,
    FinalDecision,
    SessionAggregate,
    SessionMeta,
    is_settle_eligible,
    is_settled,
)
from trade_trainer_backend.services.post_eval import (
    evaluate_entry,
    evaluate_symbol,
    quick_r_pnl,
    resolve_skip_r_unit_pips,
    resolve_trade_r_unit_pips,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


# ============================================================================
# テンプレート / レスポンス組み立てヘルパ
# ============================================================================

def _memo_templates() -> tuple[str | None, str | None]:
    """§7.2.3 メモテンプレ(候補メモ, 横断メモ)。ファイル無し→None。"""
    from trade_trainer_backend.services.memo_templates import (
        get_candidate_template, get_session_note_template,
    )
    return get_candidate_template(), get_session_note_template()


def _ensure_session(session_id: str) -> SessionAggregate:
    agg = session_store.load(session_id)
    if agg is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return agg


def _candidate_response(
    c: Candidate,
    selected_symbol: str | None,
) -> CandidateResponse:
    return CandidateResponse(
        id=c.symbol,
        symbol=c.symbol,
        memo=c.memo,
        is_selected=(selected_symbol is not None and c.symbol == selected_symbol),
        skip_reason=None,
    )


def _build_response(agg: SessionAggregate) -> SessionResponse:
    """統合フロー(§6.1): エントリー銘柄は trade.symbol から取得。"""
    selected_symbol = agg.trade.symbol if agg.trade is not None else None
    symbol = selected_symbol or ""
    has_active = agg.trade is not None and agg.trade.exit_time is None

    from market_data.accessor import get_symbol_digits
    digits = get_symbol_digits(symbol) if symbol else 5

    return SessionResponse(
        id=agg.meta.id,
        symbol=symbol,
        started_at=agg.meta.started_at,
        presented_at=agg.meta.presented_at,
        current_position=agg.meta.current_position,
        mode=agg.meta.mode,
        is_settled=is_settled(agg),
        has_active_trade=has_active,
        digits=digits,
        name=agg.meta.name,
        note=agg.note,
        candidates=[_candidate_response(c, selected_symbol) for c in agg.candidates],
        settled_at=agg.meta.settled_at,
    )


def _maybe_settle(session_id: str) -> SessionAggregate:
    """§4.2.2 決着遷移: 「決着可能 + 横断メモ非空」なら settled_at を自動セット。"""
    agg = _ensure_session(session_id)
    if agg.meta.settled_at is not None:
        return agg
    if not is_settle_eligible(agg):
        return agg
    if not agg.note or not agg.note.strip():
        return agg
    agg.meta.settled_at = datetime.now(timezone.utc)
    session_store.save_meta(agg.meta)
    return agg


# ============================================================================
# 時間フィルタによるランダム抽選(§4.1)
# ============================================================================

_JST_OFFSET = timedelta(hours=9)

# 仕様書 §2.11: セッション時間帯プリセット (JST 基準、夏時間固定なし)
_SESSION_UTC_HOUR_RANGES: dict[str, tuple[int, int]] = {
    "tokyo": (0, 6),
    "london": (7, 16),
    "ny": (13, 21),
}


def _matches_filters(
    dt_utc: datetime,
    days: list[int] | None,
    sessions: list[str] | None,
) -> bool:
    jst = dt_utc + _JST_OFFSET
    if days:
        if jst.weekday() not in days:
            return False
    if sessions:
        utc_hour = dt_utc.hour
        if not any(
            _SESSION_UTC_HOUR_RANGES[s][0] <= utc_hour < _SESSION_UTC_HOUR_RANGES[s][1]
            for s in sessions
            if s in _SESSION_UTC_HOUR_RANGES
        ):
            return False
    return True


def _random_datetime_in_range(from_ts: int, to_ts: int) -> datetime:
    offset = random.randint(0, to_ts - from_ts)
    dt = datetime.fromtimestamp(from_ts + offset, tz=timezone.utc)
    minutes = (dt.minute // 5) * 5
    return dt.replace(minute=minutes, second=0, microsecond=0)


def _random_presented_at(
    settings: Settings,
    days: list[int] | None = None,
    sessions: list[str] | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> datetime:
    now = datetime.now(timezone.utc)
    if date_from and date_to:
        from_ts = int(date_from.timestamp())
        to_ts = int(date_to.timestamp())
    else:
        from_ts = int((now - timedelta(days=settings.history_max_days)).timestamp())
        to_ts = int((now - timedelta(days=settings.history_min_days)).timestamp())

    if to_ts <= from_ts:
        raise HTTPException(status_code=400, detail="date_to must be after date_from")

    for _ in range(200):
        dt = _random_datetime_in_range(from_ts, to_ts)
        if _matches_filters(dt, days, sessions):
            return dt
    raise HTTPException(
        status_code=400,
        detail="指定された時間フィルタに合致する日時が見つかりませんでした。条件を緩めてください。",
    )


# ============================================================================
# セッション CRUD
# ============================================================================

@router.post("", response_model=SessionResponse, status_code=201)
def create_session(
    body: CreateSessionRequest,
    settings: Settings = Depends(get_settings),
) -> SessionResponse:
    presented_at = _random_presented_at(
        settings,
        days=body.days,
        sessions=body.sessions,
        date_from=body.date_from,
        date_to=body.date_to,
    )

    time_filter: dict | None = None
    if body.days or body.sessions or body.date_from or body.date_to:
        time_filter = {
            "days": body.days,
            "sessions": body.sessions,
            "date_from": body.date_from.isoformat() if body.date_from else None,
            "date_to": body.date_to.isoformat() if body.date_to else None,
        }

    agg = session_store.create_session(
        presented_at=presented_at,
        mode="training",
        time_filter=time_filter,
    )

    # §7.2.3 横断メモテンプレを初期挿入(有効時のみ)
    _, note_tpl = _memo_templates()
    if note_tpl:
        session_store.save_note(agg.meta.id, note_tpl)
        agg.note = note_tpl

    return _build_response(agg)


@router.get("", response_model=list[SessionListItem])
def list_sessions(limit: int = 100, offset: int = 0) -> list[SessionListItem]:
    """全セッションを返す(進行中 + 決着済み)。
    自動破棄は行わず、削除は OS / Dropbox 上のディレクトリ操作のみ([§13](./13-data-storage.md))。"""
    aggs = session_store.list_sessions()
    aggs = [a for a in aggs if a.meta.mode == "training"]
    aggs = aggs[offset : offset + limit]

    result: list[SessionListItem] = []
    for agg in aggs:
        trade = agg.trade
        symbol = trade.symbol if trade is not None else ""
        r_pnl = quick_r_pnl(trade) if trade is not None else None
        pips_pnl = trade.pips_pnl if trade is not None else None
        result.append(
            SessionListItem(
                id=agg.meta.id,
                symbol=symbol,
                started_at=agg.meta.started_at,
                presented_at=agg.meta.presented_at,
                mode=agg.meta.mode,
                is_settled=is_settled(agg),
                name=agg.meta.name,
                r_pnl=r_pnl,
                pips_pnl=pips_pnl,
                settled_at=agg.meta.settled_at,
            )
        )
    return result


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: str) -> SessionResponse:
    return _build_response(_ensure_session(session_id))


@router.delete("/{session_id}", status_code=204)
def close_session(session_id: str) -> None:
    """ver 1.45: アプリ側に自動破棄を持たない。本エンドポイントは互換性のため残すが
    フロントから 通常呼ばれない(削除は OS / Dropbox での手動操作)。"""
    # 何もしない(セッションは決着済みのままファイルとして残る)
    _ensure_session(session_id)


# ============================================================================
# 候補(銘柄別メモ)
# ============================================================================

@router.post("/{session_id}/candidates", response_model=CandidateResponse, status_code=201)
def add_candidate(session_id: str, body: CreateCandidateRequest) -> CandidateResponse:
    agg = _ensure_session(session_id)
    symbol = body.symbol.upper()

    existing = session_store.get_candidate(session_id, symbol)
    if existing is not None:
        if body.memo is not None:
            session_store.save_candidate(session_id, symbol, body.memo)
            existing = session_store.get_candidate(session_id, symbol) or existing
        return _candidate_response(existing, agg.trade.symbol if agg.trade else None)

    cand_tpl, _ = _memo_templates()
    initial_memo = body.memo if body.memo is not None else cand_tpl
    session_store.save_candidate(session_id, symbol, initial_memo)
    new = session_store.get_candidate(session_id, symbol)
    if new is None:
        new = Candidate(symbol=symbol, memo=initial_memo)
    return _candidate_response(new, agg.trade.symbol if agg.trade else None)


@router.patch("/{session_id}/candidates/{symbol}", response_model=CandidateResponse)
def update_candidate(
    session_id: str,
    symbol: str,
    body: UpdateCandidateRequest,
) -> CandidateResponse:
    agg = _ensure_session(session_id)
    sym = symbol.upper()
    if session_store.get_candidate(session_id, sym) is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if body.memo is not None:
        session_store.save_candidate(session_id, sym, body.memo)
    new = session_store.get_candidate(session_id, sym)
    if new is None:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return _candidate_response(new, agg.trade.symbol if agg.trade else None)


@router.delete("/{session_id}/candidates/{symbol}", status_code=204)
def delete_candidate(session_id: str, symbol: str) -> None:
    _ensure_session(session_id)
    session_store.delete_candidate(session_id, symbol.upper())


# ============================================================================
# 横断メモ・名前
# ============================================================================

@router.patch("/{session_id}/note", response_model=SessionResponse)
def update_note(session_id: str, body: UpdateNoteRequest) -> SessionResponse:
    agg = _ensure_session(session_id)
    new_note = body.note if body.note is not None else ""
    session_store.save_note(session_id, new_note)
    agg.note = new_note or None
    # §4.2.2 決着判定
    return _build_response(_maybe_settle(session_id))


@router.patch("/{session_id}/name", response_model=SessionResponse)
def update_name(session_id: str, body: UpdateSessionNameRequest) -> SessionResponse:
    agg = _ensure_session(session_id)
    name = (body.name or "").strip()
    agg.meta.name = name if name else None
    session_store.save_meta(agg.meta)
    session_store.rename_dir(session_id)
    return _build_response(_ensure_session(session_id))


# ============================================================================
# 見送り(層 2)
# ============================================================================

@router.post("/{session_id}/skip", response_model=SessionResponse)
def skip_session(session_id: str, body: SkipSessionRequest) -> SessionResponse:
    _ensure_session(session_id)
    fd = FinalDecision(
        has_entry=False,
        skip_reason=body.reason,
        considered_styles=body.considered_styles,
    )
    session_store.save_final_decision(session_id, fd)
    session_store.rename_dir(session_id)
    return _build_response(_maybe_settle(session_id))


# ============================================================================
# 事後振り返り(§9)
# ============================================================================

@router.get("/{session_id}/post-review", response_model=PostReviewResponse)
def get_post_review(session_id: str) -> PostReviewResponse:
    """§9 判断結果の事後確認。3 段階(10/50/200 本)事後 R + MFE/MAE/実損益 R。"""
    agg = _ensure_session(session_id)

    ref_dt = agg.meta.presented_at
    if ref_dt.tzinfo is None:
        ref_dt = ref_dt.replace(tzinfo=timezone.utc)

    def to_stage_resp(stages: list) -> list[StageEvalResp]:
        return [StageEvalResp(**st.__dict__) for st in stages]

    # 見送り R 基準
    considered_styles = (
        agg.final_decision.considered_styles if agg.final_decision is not None else None
    )
    skip_r_unit = resolve_skip_r_unit_pips(considered_styles)

    # 層 1: エントリーしなかった候補
    selected_symbol = agg.trade.symbol if agg.trade is not None else None
    candidate_reviews: list[CandidateReview] = []
    for c in agg.candidates:
        if selected_symbol is not None and c.symbol == selected_symbol:
            continue
        rv = evaluate_symbol(c.symbol, ref_dt, r_unit_pips=skip_r_unit)
        candidate_reviews.append(CandidateReview(
            symbol=c.symbol,
            memo=c.memo,
            skip_reason=None,
            ref_price=rv.ref_price,
            r_unit_pips=skip_r_unit,
            stages=to_stage_resp(rv.stages),
        ))

    skip_review: SkipReview | None = None
    entry_review: EntryReview | None = None
    if agg.trade is not None:
        trade_r_unit = resolve_trade_r_unit_pips(agg.trade)
        rv = evaluate_symbol(agg.trade.symbol, ref_dt, r_unit_pips=trade_r_unit)
        obs = evaluate_entry(agg.trade)
        entry_review = EntryReview(
            symbol=agg.trade.symbol,
            direction=agg.trade.direction,
            entry_price=agg.trade.entry_price,
            sl=agg.trade.sl,
            tp=agg.trade.tp,
            exit_price=agg.trade.exit_price,
            exit_reason=agg.trade.exit_reason,
            pips_pnl=agg.trade.pips_pnl,
            ref_price=rv.ref_price,
            r_unit_pips=trade_r_unit,
            stages=to_stage_resp(rv.stages),
            mfe_r=obs.mfe_r,
            mae_r=obs.mae_r,
            mfe_pips=obs.mfe_pips,
            mae_pips=obs.mae_pips,
            r_pnl=obs.r_pnl,
            continuation_bars=obs.continuation_bars,
            continuation_available=obs.continuation_available,
        )
    elif agg.final_decision is not None and not agg.final_decision.has_entry and (
        agg.final_decision.skip_reason or agg.final_decision.considered_styles
    ):
        skip_review = SkipReview(
            symbol="",
            reason=agg.final_decision.skip_reason,
            considered_styles=agg.final_decision.considered_styles,
            ref_price=None,
            r_unit_pips=skip_r_unit,
            stages=[],
        )

    return PostReviewResponse(
        candidates=candidate_reviews,
        skip=skip_review,
        entry=entry_review,
    )
