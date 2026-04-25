"""仕様書 §13 / §17 セッション情報のファイル I/O 層(ver 1.45)。

`data/sessions/{dir}/` ディレクトリを単位として読み書きする。
- 識別子は session.json の `id` フィールド(不変)
- ディレクトリ名は `{YYYYMMDD-HHMM}-{symbol}-{name}`(可読ラベル、変更可)
- 書き込みは atomic(tmp + rename)
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
# atomic write helpers
# ============================================================================

def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def _atomic_write_json(path: Path, data: Any) -> None:
    _atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2, default=_json_default))


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
    # presented_at を JST に変換
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
    """セッションディレクトリ全走査し、id → Path のインデックスを再構築する。

    破損 / 競合 / session.json 無し のディレクトリは黙ってスキップする。
    id 重複時は更新日時最新を採用、警告ログを残す。
    """
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
# セッション集約 read / write
# ============================================================================

def _read_meta(meta_path: Path) -> SessionMeta | None:
    data = _read_json(meta_path)
    if not isinstance(data, dict):
        return None
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


def _read_trade(dir_path: Path) -> Trade | None:
    data = _read_json(dir_path / "trade.json")
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
        style_id=data.get("style_id"),
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
        "style_id": t.style_id,
        "created_at": t.created_at,
    }


def _opt_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _read_final_decision(dir_path: Path) -> FinalDecision | None:
    data = _read_json(dir_path / "final_decision.json")
    if not isinstance(data, dict):
        return None
    return FinalDecision(
        has_entry=bool(data.get("has_entry", False)),
        skip_reason=data.get("skip_reason"),
        considered_styles=data.get("considered_styles"),
    )


def _fd_to_dict(fd: FinalDecision) -> dict[str, Any]:
    return {
        "has_entry": fd.has_entry,
        "skip_reason": fd.skip_reason,
        "considered_styles": fd.considered_styles,
    }


def _read_drawings(dir_path: Path) -> list[Drawing]:
    data = _read_json(dir_path / "drawings.json")
    if not isinstance(data, list):
        return []
    out: list[Drawing] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        out.append(Drawing(
            id=int(item.get("id", 0)),
            symbol=item.get("symbol"),
            kind=item.get("kind", ""),
            data=item.get("data", {}) or {},
            label=item.get("label"),
            timeframe=item.get("timeframe"),
            visible_on_timeframes=item.get("visible_on_timeframes"),
        ))
    return out


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


def _read_holding_memos(dir_path: Path) -> list[HoldingMemo]:
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
            ts = _parse_dt(rec.get("timestamp"))
            memo = rec.get("memo")
            if ts is None or not isinstance(memo, str):
                continue
            out.append(HoldingMemo(timestamp=ts, memo=memo))
    except OSError:
        return []
    return out


# ============================================================================
# パブリック API
# ============================================================================

def list_sessions() -> list[SessionAggregate]:
    """全セッションを集約として返す(meta + 関連ファイル全部)。"""
    reindex()
    out: list[SessionAggregate] = []
    for sid, dir_path in _index.items():
        agg = load(sid)
        if agg is not None:
            out.append(agg)
    out.sort(key=lambda a: a.meta.started_at, reverse=True)
    return out


def load(session_id: str) -> SessionAggregate | None:
    dir_path = get_dir(session_id)
    if dir_path is None:
        return None
    meta = _read_meta(dir_path / "session.json")
    if meta is None:
        return None
    note = _read_text(dir_path / "note.md")
    if note is not None:
        note = note.rstrip("\n") or None
    return SessionAggregate(
        meta=meta,
        note=note,
        candidates=_read_candidates(dir_path),
        trade=_read_trade(dir_path),
        final_decision=_read_final_decision(dir_path),
        drawings=_read_drawings(dir_path),
        holding_memos=_read_holding_memos(dir_path),
    )


def create_session(
    presented_at: datetime,
    mode: str = "training",
    time_filter: dict[str, Any] | None = None,
) -> SessionAggregate:
    """新規セッションのディレクトリと session.json を作成する。"""
    now = datetime.now(timezone.utc)
    sid = _new_session_id(presented_at)
    meta = SessionMeta(
        id=sid,
        name=None,
        started_at=now,
        presented_at=presented_at if presented_at.tzinfo else presented_at.replace(tzinfo=timezone.utc),
        current_position=presented_at if presented_at.tzinfo else presented_at.replace(tzinfo=timezone.utc),
        mode=mode,
        settled_at=None,
        time_filter=time_filter,
    )
    root = _resolve_root()
    root.mkdir(parents=True, exist_ok=True)
    dir_name = _build_dir_name(meta, "pending")
    target = root / dir_name
    # 衝突回避(同分時に複数セッションを作った場合)
    if target.exists():
        for i in range(2, 100):
            target_alt = root / f"{dir_name}-{i}"
            if not target_alt.exists():
                target = target_alt
                break
    target.mkdir(parents=True, exist_ok=False)
    _atomic_write_json(target / "session.json", _meta_to_dict(meta))
    _index[sid] = target
    return SessionAggregate(meta=meta, note=None)


def save_meta(meta: SessionMeta) -> None:
    """session.json を上書き保存。"""
    dir_path = get_dir(meta.id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {meta.id}")
    _atomic_write_json(dir_path / "session.json", _meta_to_dict(meta))


def save_note(session_id: str, note: str | None) -> None:
    """横断メモを保存。空文字 / None なら削除しない(空ファイルとして残す)。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    text = note if note is not None else ""
    _atomic_write_text(dir_path / "note.md", text)


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
    _atomic_write_text(cdir / f"{sym}.md", memo if memo is not None else "")


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
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    _atomic_write_json(dir_path / "trade.json", _trade_to_dict(trade))


def save_final_decision(session_id: str, fd: FinalDecision) -> None:
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    _atomic_write_json(dir_path / "final_decision.json", _fd_to_dict(fd))


def save_drawings(session_id: str, drawings: list[Drawing]) -> None:
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    _atomic_write_json(dir_path / "drawings.json", [_drawing_to_dict(d) for d in drawings])


def append_holding_memo(session_id: str, memo: HoldingMemo) -> None:
    """holding_memos.jsonl に 1 行追記。"""
    dir_path = get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    line = json.dumps(
        {"timestamp": memo.timestamp, "memo": memo.memo},
        ensure_ascii=False, default=_json_default,
    )
    p = dir_path / "holding_memos.jsonl"
    with p.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def rename_dir(session_id: str) -> Path | None:
    """meta.name / trade.symbol / final_decision.has_entry に基づいてディレクトリ名を再計算し、必要なら rename する。"""
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
        # 衝突回避
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
    drawings = load(session_id)
    if drawings is None or not drawings.drawings:
        return 1
    return max(d.id for d in drawings.drawings) + 1
