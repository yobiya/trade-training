"""セッション管理エンドポイント。"""
import random
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from shared_schema.models.trading import SessionCandidate, SessionFinalDecision, Trade, TradeSession
from trade_trainer_backend.config import Settings, get_settings
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.post_review import (
    CandidateReview,
    EntryReview,
    PostReviewResponse,
    SkipReview,
    StageEvalResp,
)
from shared_schema.models.config import Setting
from trade_trainer_backend.schemas.session import (
    CandidateResponse,
    CreateCandidateRequest,
    CreateSessionRequest,
    SelectSymbolRequest,
    SessionListItem,
    SessionResponse,
    SkipSessionRequest,
    UpdateCandidateRequest,
    UpdateNoteRequest,
)
from trade_trainer_backend.services.post_eval import evaluate_symbol

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _memo_templates(db: Session) -> tuple[str | None, str | None]:
    """仕様書 §7.2.3: 新規メモ作成時に挿入するテンプレート(有効時のみ)を返す。
    戻り値: (candidate_memo_template, session_note_template)。無効時は (None, None)。"""
    st = db.get(Setting, 1)
    if st is None or not st.memo_template_enabled:
        return None, None
    return st.candidate_memo_template, st.session_note_template


def _build_response(s: TradeSession, db: Session) -> SessionResponse:
    fd = db.get(SessionFinalDecision, s.id)
    symbol = fd.symbol if fd else ""
    from shared_schema.models.trading import Trade
    active_trade = db.scalars(
        select(Trade).where(Trade.session_id == s.id, Trade.exit_time.is_(None))
    ).first()

    from market_data.accessor import get_symbol_digits
    digits = get_symbol_digits(symbol) if symbol else 5

    candidates = db.scalars(
        select(SessionCandidate).where(SessionCandidate.session_id == s.id).order_by(SessionCandidate.id)
    ).all()

    return SessionResponse(
        id=s.id,
        symbol=symbol or "",
        started_at=s.started_at,
        presented_at=s.presented_at,
        current_position=s.current_position,
        mode=s.mode,
        is_suspended=s.is_suspended,
        has_active_trade=active_trade is not None,
        digits=digits,
        note=s.note,
        candidates=[CandidateResponse.model_validate(c) for c in candidates],
    )


_JST_OFFSET = timedelta(hours=9)

# 仕様書 §2.11: セッション時間帯プリセット (JST 基準、夏時間固定なし)
# tokyo: 09-15 JST = 00-06 UTC
# london: 16-25 JST (翌01JST まで) = 07-16 UTC
# ny: 22-06 JST (翌) = 13-21 UTC
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
    """曜日・セッション時間帯フィルタに合致するか判定する。"""
    jst = dt_utc + _JST_OFFSET  # naive JST
    if days:
        # 曜日判定は JST 基準(ユーザーの感覚に合わせる)
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
    """フィルタに合致するランダムな M5 日時を返す (rejection sampling)。"""
    now = datetime.now(timezone.utc)
    if date_from and date_to:
        from_ts = int(date_from.timestamp())
        to_ts = int(date_to.timestamp())
    else:
        from_ts = int((now - timedelta(days=settings.history_max_days)).timestamp())
        to_ts = int((now - timedelta(days=settings.history_min_days)).timestamp())

    if to_ts <= from_ts:
        raise HTTPException(status_code=400, detail="date_to must be after date_from")

    # フィルタなしなら 1 回で終わる
    for _ in range(200):
        dt = _random_datetime_in_range(from_ts, to_ts)
        if _matches_filters(dt, days, sessions):
            return dt
    raise HTTPException(
        status_code=400,
        detail="指定された時間フィルタに合致する日時が見つかりませんでした。条件を緩めてください。",
    )


@router.post("", response_model=SessionResponse, status_code=201)
def create_session(
    body: CreateSessionRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SessionResponse:
    presented_at = _random_presented_at(
        settings,
        days=body.days,
        sessions=body.sessions,
        date_from=body.date_from,
        date_to=body.date_to,
    )

    now = datetime.now(timezone.utc)
    session_id = str(uuid.uuid4())

    # §7.2.3: 新規セッション作成時に横断メモのテンプレートを初期挿入(有効時のみ)
    _, note_tpl = _memo_templates(db)

    ts = TradeSession(
        id=session_id,
        started_at=now,
        presented_at=presented_at,
        current_position=presented_at,
        mode="training",
        is_suspended=False,
        note=note_tpl,
    )
    db.add(ts)
    # 銘柄は任意。指定があれば即座に SessionFinalDecision を作成する。
    if body.symbol:
        fd = SessionFinalDecision(
            session_id=session_id,
            symbol=body.symbol.upper(),
            has_entry=False,
        )
        db.add(fd)
    db.commit()
    db.refresh(ts)
    return _build_response(ts, db)


@router.post("/{session_id}/symbol", response_model=SessionResponse)
def select_symbol(
    session_id: str,
    body: SelectSymbolRequest,
    db: Session = Depends(get_db),
) -> SessionResponse:
    """銘柄選定(仕様書 §4.1 Phase 2, §6.3.2)。
    確定した銘柄を SessionFinalDecision.symbol に保存し、他候補の見送り理由も一括反映する。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    symbol = body.symbol.upper()
    fd = db.get(SessionFinalDecision, session_id)
    if fd is None:
        fd = SessionFinalDecision(
            session_id=session_id,
            symbol=symbol,
            has_entry=False,
        )
        db.add(fd)
    else:
        fd.symbol = symbol

    # 候補の is_selected 更新 + 見送り理由の一括保存(§6.3.2)
    candidates = db.scalars(
        select(SessionCandidate).where(SessionCandidate.session_id == session_id)
    ).all()
    for c in candidates:
        c.is_selected = c.symbol.upper() == symbol
        if not c.is_selected and body.skip_reasons is not None:
            reason = body.skip_reasons.get(c.id)
            if reason is not None:
                c.skip_reason = reason

    db.commit()
    return _build_response(s, db)


# 仕様書 §6.3 ウォッチリスト(候補)CRUD
@router.post("/{session_id}/candidates", response_model=CandidateResponse, status_code=201)
def add_candidate(
    session_id: str,
    body: CreateCandidateRequest,
    db: Session = Depends(get_db),
) -> CandidateResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    symbol = body.symbol.upper()
    existing = db.scalars(
        select(SessionCandidate).where(
            SessionCandidate.session_id == session_id,
            SessionCandidate.symbol == symbol,
        )
    ).first()
    if existing:
        if body.memo is not None:
            existing.memo = body.memo
        db.commit()
        db.refresh(existing)
        return CandidateResponse.model_validate(existing)
    # §7.2.3: 新規候補作成時に銘柄別メモのテンプレートを初期挿入(body.memo 未指定かつ有効時のみ)
    cand_tpl, _ = _memo_templates(db)
    initial_memo = body.memo if body.memo is not None else cand_tpl
    c = SessionCandidate(session_id=session_id, symbol=symbol, memo=initial_memo, is_selected=False)
    db.add(c)
    db.commit()
    db.refresh(c)
    return CandidateResponse.model_validate(c)


@router.patch("/{session_id}/candidates/{candidate_id}", response_model=CandidateResponse)
def update_candidate(
    session_id: str,
    candidate_id: int,
    body: UpdateCandidateRequest,
    db: Session = Depends(get_db),
) -> CandidateResponse:
    c = db.get(SessionCandidate, candidate_id)
    if c is None or c.session_id != session_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if body.memo is not None:
        c.memo = body.memo
    db.commit()
    db.refresh(c)
    return CandidateResponse.model_validate(c)


@router.delete("/{session_id}/candidates/{candidate_id}", status_code=204)
def delete_candidate(
    session_id: str,
    candidate_id: int,
    db: Session = Depends(get_db),
) -> None:
    c = db.get(SessionCandidate, candidate_id)
    if c is None or c.session_id != session_id:
        raise HTTPException(status_code=404, detail="Candidate not found")
    db.delete(c)
    db.commit()


@router.get("", response_model=list[SessionListItem])
def list_sessions(
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> list[SessionListItem]:
    """仕様書 §10.3: 完了セッションは UI から参照できない(閉じると DB からも削除)。
    DB に残っているセッションはすべて進行中 or 保留中。"""
    sessions = db.scalars(
        select(TradeSession)
        .where(TradeSession.mode == "training")
        .order_by(TradeSession.started_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()

    result = []
    for s in sessions:
        fd = db.get(SessionFinalDecision, s.id)
        result.append(
            SessionListItem(
                id=s.id,
                symbol=fd.symbol if fd else "",
                started_at=s.started_at,
                presented_at=s.presented_at,
                mode=s.mode,
                is_suspended=s.is_suspended,
            )
        )
    return result


@router.get("/{session_id}/post-review", response_model=PostReviewResponse)
def get_post_review(session_id: str, db: Session = Depends(get_db)) -> PostReviewResponse:
    """仕様書 §9.2 見送り事後検証 + §9.4 1 セッション単位の振り返り表示。
    層 1 / 層 2 / エントリー済みトレードについて、presented_at 起点の
    3 段階(10/50/200 本先)事後評価を on-demand で返す(§10 により DB 保存はしない)。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")

    ref_dt = s.presented_at
    if ref_dt.tzinfo is None:
        ref_dt = ref_dt.replace(tzinfo=timezone.utc)

    def to_stage_resp(stages: list) -> list[StageEvalResp]:
        return [StageEvalResp(**st.__dict__) for st in stages]

    # 層 1: 非選定候補
    candidate_reviews: list[CandidateReview] = []
    for c in db.scalars(
        select(SessionCandidate).where(
            SessionCandidate.session_id == session_id,
            SessionCandidate.is_selected.is_(False),
        ).order_by(SessionCandidate.id)
    ).all():
        rv = evaluate_symbol(c.symbol, ref_dt)
        candidate_reviews.append(CandidateReview(
            symbol=c.symbol,
            memo=c.memo,
            skip_reason=c.skip_reason,
            ref_price=rv.ref_price,
            stages=to_stage_resp(rv.stages),
        ))

    # 層 2: エントリー見送り(symbol が確定しているが has_entry=False)
    fd = db.get(SessionFinalDecision, session_id)
    skip_review: SkipReview | None = None
    entry_review: EntryReview | None = None
    if fd is not None and fd.symbol:
        if not fd.has_entry:
            rv = evaluate_symbol(fd.symbol, ref_dt)
            skip_review = SkipReview(
                symbol=fd.symbol,
                reason=fd.skip_reason,
                considered_styles=fd.considered_styles,
                ref_price=rv.ref_price,
                stages=to_stage_resp(rv.stages),
            )
        else:
            # エントリー済みトレードの振り返り
            trade = db.scalars(
                select(Trade).where(Trade.session_id == session_id).order_by(Trade.entry_time.desc())
            ).first()
            if trade is not None:
                rv = evaluate_symbol(trade.symbol, ref_dt)
                entry_review = EntryReview(
                    symbol=trade.symbol,
                    direction=trade.direction,
                    entry_price=trade.entry_price,
                    sl=trade.sl,
                    tp=trade.tp,
                    exit_price=trade.exit_price,
                    exit_reason=trade.exit_reason,
                    pips_pnl=trade.pips_pnl,
                    ref_price=rv.ref_price,
                    stages=to_stage_resp(rv.stages),
                )

    return PostReviewResponse(
        candidates=candidate_reviews,
        skip=skip_review,
        entry=entry_review,
    )


@router.patch("/{session_id}/note", response_model=SessionResponse)
def update_note(
    session_id: str,
    body: UpdateNoteRequest,
    db: Session = Depends(get_db),
) -> SessionResponse:
    """§7.2.2 横断メモの更新。空文字 or null は許容(クリア)。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    s.note = body.note
    db.commit()
    return _build_response(s, db)


@router.delete("/{session_id}", status_code=204)
def close_session(session_id: str, db: Session = Depends(get_db)) -> None:
    """セッションを閉じる(=破棄)。仕様書 §10.3 セッションライフサイクルの終端。
    関連する候補・最終判断・トレード・シナリオ・描画・保有中メモは cascade で削除される。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(s)
    db.commit()


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(session_id: str, db: Session = Depends(get_db)) -> SessionResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return _build_response(s, db)


@router.post("/{session_id}/skip", response_model=SessionResponse)
def skip_session(
    session_id: str,
    body: SkipSessionRequest,
    db: Session = Depends(get_db),
) -> SessionResponse:
    """見送り: エントリーせずにセッションを完了する(§7.3 層 2 / §9.1 全候補見送り)。"""
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    fd = db.get(SessionFinalDecision, session_id)
    if fd is None:
        fd = SessionFinalDecision(session_id=session_id, has_entry=False)
        db.add(fd)
    fd.has_entry = False
    fd.skip_reason = body.reason
    if body.considered_styles is not None:
        fd.considered_styles = body.considered_styles
    db.commit()
    return _build_response(s, db)


@router.patch("/{session_id}/suspend", response_model=SessionResponse)
def suspend_session(session_id: str, db: Session = Depends(get_db)) -> SessionResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    s.is_suspended = True
    db.commit()
    return _build_response(s, db)


@router.patch("/{session_id}/resume", response_model=SessionResponse)
def resume_session(session_id: str, db: Session = Depends(get_db)) -> SessionResponse:
    s = db.get(TradeSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    s.is_suspended = False
    db.commit()
    return _build_response(s, db)
