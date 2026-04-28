"""仕様書 §13 / §17 セッション情報のファイル I/O 層(ver 1.54: session.json 統合)。

`data/sessions/{dir}/` ディレクトリを単位として読み書きする。
- 識別子は session.json の `id` フィールド(不変)
- ディレクトリ名は `{YYYYMMDD-HHMM}-{symbol}-{name}`(可読ラベル、変更可)
- ver 1.54 から session.json に trade / final_decision / drawings / holding_memos を統合
- 旧形式(個別 .json / .jsonl)は読み出し時のみフォールバックで対応、次回 save 時に統合形式へ自動移行
- 削除はアプリ側で行わない(OS 直接操作のみ、§13)
- 起動時 + 一覧取得時にディレクトリを再走査して id → Path のインデックスを構築
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from trade_trainer_backend.services.session_models import (
    Candidate,
    Drawing,
    FinalDecision,
    HoldingMemo,
    SessionAggregate,
    SessionMeta,
    Trade,
)

logger = logging.getLogger(__name__)


SAFE_NAME_RE = re.compile(r'[/\\:\*\?"<>|\x00-\x1f]')

# Dropbox 等が生成する競合ファイルのパターン(一覧スキャンで除外)
_CONFLICT_PATTERNS = (
    "Conflicted copy",
    ".conflict",
)


# ============================================================================
# パス解決
# ============================================================================

def _resolve_root() -> Path:
    env = os.environ.get("SESSIONS_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    repo_root = here.parents[6]
    return repo_root / "data" / "sessions"


def _is_conflict_name(name: str) -> bool:
    return any(p in name for p in _CONFLICT_PATTERNS)


# ============================================================================
# 単純書き込みヘルパ(ver 1.54 で atomic を撤去)
# ============================================================================

def _write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _write_json(path: Path, data: Any) -> None:
    _write_text(path, json.dumps(data, ensure_ascii=False, indent=2, default=_json_default))


def _json_default(o: Any) -> Any:
    if isinstance(o, datetime):
        # naive は UTC 扱い
        if o.tzinfo is None:
            o = o.replace(tzinfo=timezone.utc)
        return o.isoformat().replace("+00:00", "Z")
    raise TypeError(f"Not JSON serializable: {type(o)}")


def _read_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("failed to read JSON %s: %s", path, e)
        return None


def _read_text(path: Path) -> str | None:
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning("failed to read text %s: %s", path, e)
        return None


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


# ============================================================================
# サニタイズ・命名
# ============================================================================

def _sanitize_dir_part(s: str | None, fallback: str) -> str:
    if not s:
        return fallback
    s = SAFE_NAME_RE.sub("-", s).strip(" -.")
    if not s or s in (".", ".."):
        return fallback
    return s


def _build_dir_name(meta: SessionMeta, symbol_part: str | None) -> str:
    """{YYYYMMDD-HHMM}-{symbol}-{name} 形式(JST)。"""
    pa = meta.presented_at
    if pa.tzinfo is None:
        pa = pa.replace(tzinfo=timezone.utc)
    jst = pa.astimezone(timezone(_jst_offset()))
    date_part = jst.strftime("%Y%m%d-%H%M")
    sym = _sanitize_dir_part(symbol_part, "pending")
    name_part = _sanitize_dir_part(meta.name, "untitled")
    return f"{date_part}-{sym}-{name_part}"


def _jst_offset():
    from datetime import timedelta
    return timedelta(hours=9)


def _new_session_id(presented_at: datetime) -> str:
    """`YYYYMMDD-HHMM-xxxx` 形式の不変識別子。"""
    pa = presented_at
    if pa.tzinfo is None:
        pa = pa.replace(tzinfo=timezone.utc)
    jst = pa.astimezone(timezone(_jst_offset()))
    suffix = secrets.token_hex(2)  # 4 hex chars
    return f"{jst.strftime('%Y%m%d-%H%M')}-{suffix}"


# ============================================================================
# インデックス: id → Path
# ============================================================================

_index: dict[str, Path] = {}


def reindex() -> None:
    """セッションディレクトリ全走査し、id → Path のインデックスを再構築する。"""
    root = _resolve_root()
    seen: dict[str, Path] = {}
    if not root.exists():
        _index.clear()
        return
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        if _is_conflict_name(d.name):
            continue
        meta_path = d / "session.json"
        if not meta_path.exists():
            continue
        data = _read_json(meta_path)
        if not isinstance(data, dict):
            continue
        sid = data.get("id")
        if not isinstance(sid, str):
            continue
        if sid in seen:
            existing = seen[sid]
            if d.stat().st_mtime > existing.stat().st_mtime:
                logger.warning("duplicate session id %s: replacing %s with %s", sid, existing, d)
                seen[sid] = d
            else:
                logger.warning("duplicate session id %s: ignoring %s (older than %s)", sid, d, existing)
        else:
            seen[sid] = d
    _index.clear()
    _index.update(seen)


def get_dir(session_id: str) -> Path | None:
    """id からディレクトリを取得。ディレクトリが消えていたら再インデックスして再試行。"""
    p = _index.get(session_id)
    if p is not None and p.exists():
        return p
    reindex()
    p = _index.get(session_id)
    return p if p is not None and p.exists() else None


# ============================================================================
# session.json シリアライズ / デシリアライズ
# ============================================================================

def _opt_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _trade_from_dict(data: Any) -> Trade | None:
    if not isinstance(data, dict):
        return None
    return Trade(
        id=data.get("id", ""),
        symbol=data.get("symbol", ""),
        direction=data.get("direction", "buy"),
        entry_time=_parse_dt(data.get("entry_time")) or datetime.now(timezone.utc),
        entry_price=float(data.get("entry_price", 0)),
        sl=_opt_float(data.get("sl")),
        tp=_opt_float(data.get("tp")),
        exit_time=_parse_dt(data.get("exit_time")),
        exit_price=_opt_float(data.get("exit_price")),
        exit_reason=data.get("exit_reason"),
        pips_pnl=_opt_float(data.get("pips_pnl")),
        amount_pnl=_opt_float(data.get("amount_pnl")),
        lot=_opt_float(data.get("lot")),
        mt5_order_id=data.get("mt5_order_id"),
        created_at=_parse_dt(data.get("created_at")) or datetime.now(timezone.utc),
    )


def _trade_to_dict(t: Trade) -> dict[str, Any]:
    return {
        "id": t.id,
        "symbol": t.symbol,
        "direction": t.direction,
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


def _fd_from_dict(data: Any) -> FinalDecision | None:
    if not isinstance(data, dict):
        return None
    return FinalDecision(
        has_entry=bool(data.get("has_entry", False)),
        skip_reason=data.get("skip_reason"),
    )


def _fd_to_dict(fd: FinalDecision) -> dict[str, Any]:
    return {"has_entry": fd.has_entry, "skip_reason": fd.skip_reason}


def _drawing_from_dict(item: Any) -> Drawing | None:
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


def _drawing_to_dict(d: Drawing) -> dict[str, Any]:
    return {
        "id": d.id,
        "symbol": d.symbol,
        "kind": d.kind,
        "data": d.data,
        "label": d.label,
        "timeframe": d.timeframe,
        "visible_on_timeframes": d.visible_on_timeframes,
    }


def _holding_memo_from_dict(rec: Any) -> HoldingMemo | None:
    if not isinstance(rec, dict):
        return None
    ts = _parse_dt(rec.get("timestamp"))
    memo = rec.get("memo")
    if ts is None or not isinstance(memo, str):
        return None
    return HoldingMemo(timestamp=ts, memo=memo)


def _holding_memo_to_dict(m: HoldingMemo) -> dict[str, Any]:
    return {"timestamp": m.timestamp, "memo": m.memo}


def _meta_from_dict(data: dict[str, Any]) -> SessionMeta | None:
    sid = data.get("id")
    presented_at = _parse_dt(data.get("presented_at"))
    started_at = _parse_dt(data.get("started_at"))
    current_position = _parse_dt(data.get("current_position"))
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
        settled_at=_parse_dt(data.get("settled_at")),
        time_filter=data.get("time_filter"),
        indicator_config_id=data.get("indicator_config_id"),
    )


def _meta_to_dict(meta: SessionMeta) -> dict[str, Any]:
    return {
        "id": meta.id,
        "name": meta.name,
        "started_at": meta.started_at,
        "presented_at": meta.presented_at,
        "current_position": meta.current_position,
        "mode": meta.mode,
        "settled_at": meta.settled_at,
        "time_filter": meta.time_filter,
        "indicator_config_id": meta.indicator_config_id,
    }


def _aggregate_to_session_dict(agg: SessionAggregate) -> dict[str, Any]:
    """SessionAggregate を session.json のシリアライズ形式に変換。"""
    base = _meta_to_dict(agg.meta)
    base["trade"] = _trade_to_dict(agg.trade) if agg.trade is not None else None
    base["final_decision"] = _fd_to_dict(agg.final_decision) if agg.final_decision is not None else None
    base["drawings"] = [_drawing_to_dict(d) for d in agg.drawings]
    base["holding_memos"] = [_holding_memo_to_dict(m) for m in agg.holding_memos]
    return base


# ============================================================================
# 旧形式(ver 1.54 以前)からの読み出しフォールバック
# ============================================================================

def _read_legacy_trade(dir_path: Path) -> Trade | None:
    return _trade_from_dict(_read_json(dir_path / "trade.json"))


def _read_legacy_final_decision(dir_path: Path) -> FinalDecision | None:
    return _fd_from_dict(_read_json(dir_path / "final_decision.json"))


def _read_legacy_drawings(dir_path: Path) -> list[Drawing]:
    data = _read_json(dir_path / "drawings.json")
    if not isinstance(data, list):
        return []
    out: list[Drawing] = []
    for item in data:
        d = _drawing_from_dict(item)
        if d is not None:
            out.append(d)
    return out


def _read_legacy_holding_memos(dir_path: Path) -> list[HoldingMemo]:
    p = dir_path / "holding_memos.jsonl"
    if not p.exists():
        return []
    out: list[HoldingMemo] = []
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            m = _holding_memo_from_dict(rec)
            if m is not None:
                out.append(m)
    except OSError:
        return []
    return out


def _delete_legacy_files(dir_path: Path) -> None:
    """次回 save 時、統合形式へ移行した後の旧個別ファイル群を削除する。"""
    for name in ("trade.json", "final_decision.json", "drawings.json", "holding_memos.jsonl"):
        p = dir_path / name
        if p.exists():
            try:
                p.unlink()
            except OSError as e:
                logger.warning("failed to remove legacy file %s: %s", p, e)


# ============================================================================
# candidates/{symbol}.md
# ============================================================================

def _read_candidates(dir_path: Path) -> list[Candidate]:
    cdir = dir_path / "candidates"
    if not cdir.exists():
        return []
    out: list[Candidate] = []
    for p in sorted(cdir.glob("*.md")):
        if _is_conflict_name(p.name):
            continue
        symbol = p.stem.upper()
        memo = _read_text(p)
        if memo is not None:
            memo = memo.rstrip("\n")
            if not memo:
                memo = None
        out.append(Candidate(symbol=symbol, memo=memo))
    return out


# ============================================================================
# パブリック API
# ============================================================================

def list_sessions() -> list[SessionAggregate]:
    """全セッションを集約として返す。"""
    reindex()
    out: list[SessionAggregate] = []
    for sid in _index.keys():
        agg = load(sid)
        if agg is not None:
            out.append(agg)
    out.sort(key=lambda a: a.meta.started_at, reverse=True)
    return out


def load(session_id: str) -> SessionAggregate | None:
    """session.json + note.md + candidates/*.md を読んで SessionAggregate に組み立てる。

    session.json に trade / final_decision / drawings / holding_memos が無い場合は
    旧形式(個別ファイル)からフォールバック読み出し(ver 1.54 後方互換)。
    """
    dir_path = get_dir(session_id)
    if dir_path is None:
        return None
    data = _read_json(dir_path / "session.json")
    if not isinstance(data, dict):
        return None
    meta = _meta_from_dict(data)
    if meta is None:
        return None

    # session.json 内のフィールドを優先、無ければ旧個別ファイルから読む
    if "trade" in data:
        trade = _trade_from_dict(data["trade"]) if data["trade"] is not None else None
    else:
        trade = _read_legacy_trade(dir_path)

    if "final_decision" in data:
        final_decision = _fd_from_dict(data["final_decision"]) if data["final_decision"] is not None else None
    else:
        final_decision = _read_legacy_final_decision(dir_path)

    if "drawings" in data and isinstance(data["drawings"], list):
        drawings: list[Drawing] = []
        for item in data["drawings"]:
            d = _drawing_from_dict(item)
            if d is not None:
                drawings.append(d)
    else:
        drawings = _read_legacy_drawings(dir_path)

    if "holding_memos" in data and isinstance(data["holding_memos"], list):
        holding_memos: list[HoldingMemo] = []
        for item in data["holding_memos"]:
            m = _holding_memo_from_dict(item)
            if m is not None:
                holding_memos.append(m)
    else:
        holding_memos = _read_legacy_holding_memos(dir_path)

    note = _read_text(dir_path / "note.md")
    if note is not None:
        note = note.rstrip("\n") or None

    return SessionAggregate(
        meta=meta,
        note=note,
        candidates=_read_candidates(dir_path),
        trade=trade,
        final_decision=final_decision,
        drawings=drawings,
        holding_memos=holding_memos,
    )


def _write_session_json(dir_path: Path, agg: SessionAggregate) -> None:
    """SessionAggregate を session.json に統合形式で書き込み、旧個別ファイルを削除する。"""
    _write_json(dir_path / "session.json", _aggregate_to_session_dict(agg))
    _delete_legacy_files(dir_path)


def create_session(
    presented_at: datetime,
    mode: str = "training",
    time_filter: dict[str, Any] | None = None,
) -> SessionAggregate:
    """新規セッションのディレクトリと session.json を作成する。"""
    now = datetime.now(timezone.utc)
    sid = _new_session_id(presented_at)
    pa = presented_at if presented_at.tzinfo else presented_at.replace(tzinfo=timezone.utc)
    meta = SessionMeta(
        id=sid,
        name=None,
        started_at=now,
        presented_at=pa,
        current_position=pa,
        mode=mode,
        settled_at=None,
        time_filter=time_filter,
    )
    root = _resolve_root()
    root.mkdir(parents=True, exist_ok=True)
    dir_name = _build_dir_name(meta, "pending")
    target = root / dir_name
    if target.exists():
        for i in range(2, 100):
            target_alt = root / f"{dir_name}-{i}"
            if not target_alt.exists():
                target = target_alt
                break
    target.mkdir(parents=True, exist_ok=False)
    agg = SessionAggregate(meta=meta, note=None)
    _write_session_json(target, agg)
    _index[sid] = target
    return agg


def save_meta(meta: SessionMeta) -> None:
    """session.json の meta 部分のみ更新(他フィールド保持)。"""
    dir_path = get_dir(meta.id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {meta.id}")
    agg = load(meta.id)
    if agg is None:
        # 異常時はメタだけ書く(後方互換)
        agg = SessionAggregate(meta=meta, note=None)
    else:
        agg.meta = meta
    _write_session_json(dir_path, agg)


def save_note(session_id: str, note: str | None) -> None:
    """横断メモを保存。空文字 / None なら空ファイルとして残す。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    text = note if note is not None else ""
    _write_text(dir_path / "note.md", text)


def save_candidate(session_id: str, symbol: str, memo: str | None) -> None:
    """銘柄別メモを保存。symbol が ASCII 英数字でない場合は弾く。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    sym = symbol.upper()
    if not re.fullmatch(r"[A-Z0-9]+", sym):
        raise ValueError(f"invalid symbol: {symbol}")
    cdir = dir_path / "candidates"
    cdir.mkdir(parents=True, exist_ok=True)
    _write_text(cdir / f"{sym}.md", memo if memo is not None else "")


def delete_candidate(session_id: str, symbol: str) -> None:
    dir_path = get_dir(session_id)
    if dir_path is None:
        return
    sym = symbol.upper()
    target = dir_path / "candidates" / f"{sym}.md"
    if target.exists():
        target.unlink()


def get_candidate(session_id: str, symbol: str) -> Candidate | None:
    dir_path = get_dir(session_id)
    if dir_path is None:
        return None
    sym = symbol.upper()
    p = dir_path / "candidates" / f"{sym}.md"
    if not p.exists():
        return None
    memo = _read_text(p)
    if memo is not None:
        memo = memo.rstrip("\n") or None
    return Candidate(symbol=sym, memo=memo)


def save_trade(session_id: str, trade: Trade) -> None:
    """session.json の trade フィールドを更新。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg = load(session_id)
    if agg is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg.trade = trade
    _write_session_json(dir_path, agg)


def save_final_decision(session_id: str, fd: FinalDecision) -> None:
    """session.json の final_decision フィールドを更新。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg = load(session_id)
    if agg is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg.final_decision = fd
    _write_session_json(dir_path, agg)


def save_drawings(session_id: str, drawings: list[Drawing]) -> None:
    """session.json の drawings フィールドを更新。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg = load(session_id)
    if agg is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg.drawings = drawings
    _write_session_json(dir_path, agg)


def append_holding_memo(session_id: str, memo: HoldingMemo) -> None:
    """session.json の holding_memos 配列に末尾追加。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg = load(session_id)
    if agg is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg.holding_memos = list(agg.holding_memos) + [memo]
    _write_session_json(dir_path, agg)


def rename_dir(session_id: str) -> Path | None:
    """meta.name / trade.symbol / final_decision.has_entry に基づいてディレクトリ名を再計算し rename。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        return None
    agg = load(session_id)
    if agg is None:
        return dir_path
    if agg.trade is not None:
        symbol_part = agg.trade.symbol
    elif agg.final_decision is not None and not agg.final_decision.has_entry:
        symbol_part = "skipped"
    else:
        symbol_part = "pending"
    new_name = _build_dir_name(agg.meta, symbol_part)
    if new_name == dir_path.name:
        return dir_path
    new_path = dir_path.parent / new_name
    if new_path.exists() and new_path != dir_path:
        for i in range(2, 100):
            alt = dir_path.parent / f"{new_name}-{i}"
            if not alt.exists():
                new_path = alt
                break
    os.rename(dir_path, new_path)
    _index[session_id] = new_path
    return new_path


def next_drawing_id(session_id: str) -> int:
    """既存描画から最大 id を取り出して +1 を返す。"""
    agg = load(session_id)
    if agg is None or not agg.drawings:
        return 1
    return max(d.id for d in agg.drawings) + 1
