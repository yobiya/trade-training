"""仕様書 §13 / §17 セッション情報のファイル I/O 公開窓口(2026-04-29 でパッケージ化)。

旧 `services/session_store.py` を `io.py`(I/O + index)+ `serialize.py`(変換)+
本 `__init__.py`(公開 API + 後方互換読み出し)に分割した。`from trade_trainer_backend.services
import session_store` から従来通り `session_store.load(...)` 等が利用可能。

設計原則(設計 §D.3):
- ディレクトリ単位で読み書きする(`data/sessions/{dir}/`)
- 識別子は session.json の `id` フィールド(不変)
- ディレクトリ名は `{YYYYMMDD-HHMM}-{symbol}-{name}`(可読ラベル、変更可)
- ver 1.54 から session.json に trade / final_decision / drawings / holding_memos を統合
- 旧形式(個別 .json / .jsonl)は読み出し時のみフォールバック対応、次回 save で自動移行
- 削除はアプリ側で行わない(OS 直接操作のみ、§13)
"""
from __future__ import annotations

import logging
import os
import re
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
from trade_trainer_backend.utils.datetime import ensure_aware_utc
from trade_trainer_backend.utils.json_io import read_text, write_json, write_text

from . import io, serialize

logger = logging.getLogger(__name__)


# ============================================================================
# 内部 helper
# ============================================================================

def _write_session_json(dir_path: Path, agg: SessionAggregate) -> None:
    """SessionAggregate を session.json に統合形式で書き込み、旧個別ファイルを削除する。"""
    write_json(dir_path / "session.json", serialize.aggregate_to_session_dict(agg))
    io.delete_legacy_files(dir_path)


# ============================================================================
# パブリック API
# ============================================================================

def reindex() -> None:
    """ディレクトリ全走査して id → Path のインデックスを再構築する。"""
    io.reindex()


def get_dir(session_id: str) -> Path | None:
    return io.get_dir(session_id)


def list_sessions() -> list[SessionAggregate]:
    """全セッションを集約として返す。"""
    io.reindex()
    out: list[SessionAggregate] = []
    for sid in io.all_indexed_ids():
        agg = load(sid)
        if agg is not None:
            out.append(agg)
    out.sort(key=lambda a: a.meta.started_at, reverse=True)
    return out


def load(session_id: str) -> SessionAggregate | None:
    """session.json + note.md + candidates/*.md を読んで SessionAggregate に組み立てる。

    session.json 内のフィールドが優先。無ければ旧個別ファイルからフォールバック(ver 1.54 後方互換)。
    """
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        return None
    from trade_trainer_backend.utils.json_io import read_json
    data = read_json(dir_path / "session.json")
    if not isinstance(data, dict):
        return None
    meta = serialize.meta_from_dict(data)
    if meta is None:
        return None

    # session.json 内のフィールドを優先、無ければ旧個別ファイルから読む
    if "trade" in data:
        trade = serialize.trade_from_dict(data["trade"]) if data["trade"] is not None else None
    else:
        trade = serialize.trade_from_dict(io.read_legacy_trade_dict(dir_path))

    if "final_decision" in data:
        final_decision = serialize.fd_from_dict(data["final_decision"]) if data["final_decision"] is not None else None
    else:
        final_decision = serialize.fd_from_dict(io.read_legacy_fd_dict(dir_path))

    if "drawings" in data and isinstance(data["drawings"], list):
        drawings: list[Drawing] = []
        for item in data["drawings"]:
            d = serialize.drawing_from_dict(item)
            if d is not None:
                drawings.append(d)
    else:
        drawings = []
        for item in io.read_legacy_drawings_list(dir_path):
            d = serialize.drawing_from_dict(item)
            if d is not None:
                drawings.append(d)

    if "holding_memos" in data and isinstance(data["holding_memos"], list):
        holding_memos: list[HoldingMemo] = []
        for item in data["holding_memos"]:
            m = serialize.holding_memo_from_dict(item)
            if m is not None:
                holding_memos.append(m)
    else:
        holding_memos = []
        for item in io.read_legacy_holding_memos_jsonl(dir_path):
            m = serialize.holding_memo_from_dict(item)
            if m is not None:
                holding_memos.append(m)

    note = read_text(dir_path / "note.md")
    if note is not None:
        note = note.rstrip("\n") or None

    return SessionAggregate(
        meta=meta,
        note=note,
        candidates=io.read_candidates(dir_path),
        trade=trade,
        final_decision=final_decision,
        drawings=drawings,
        holding_memos=holding_memos,
    )


def create_session(
    presented_at: datetime,
    mode: str = "training",
    time_filter: dict[str, Any] | None = None,
) -> SessionAggregate:
    """新規セッションのディレクトリと session.json を作成する。"""
    now = datetime.now(timezone.utc)
    sid = io.new_session_id(presented_at)
    pa = ensure_aware_utc(presented_at)
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
    root = io.resolve_root()
    root.mkdir(parents=True, exist_ok=True)
    dir_name = io.build_dir_name(meta, "pending")
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
    io.register_index(sid, target)
    return agg


def save_meta(meta: SessionMeta) -> None:
    """session.json の meta 部分のみ更新(他フィールド保持)。"""
    dir_path = io.get_dir(meta.id)
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
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    text = note if note is not None else ""
    write_text(dir_path / "note.md", text)


def save_candidate(session_id: str, symbol: str, memo: str | None) -> None:
    """銘柄別メモを保存。symbol が ASCII 英数字でない場合は弾く。"""
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    sym = symbol.upper()
    if not re.fullmatch(r"[A-Z0-9]+", sym):
        raise ValueError(f"invalid symbol: {symbol}")
    cdir = dir_path / "candidates"
    cdir.mkdir(parents=True, exist_ok=True)
    write_text(cdir / f"{sym}.md", memo if memo is not None else "")


def delete_candidate(session_id: str, symbol: str) -> None:
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        return
    sym = symbol.upper()
    target = dir_path / "candidates" / f"{sym}.md"
    if target.exists():
        target.unlink()


def get_candidate(session_id: str, symbol: str) -> Candidate | None:
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        return None
    sym = symbol.upper()
    p = dir_path / "candidates" / f"{sym}.md"
    if not p.exists():
        return None
    memo = read_text(p)
    if memo is not None:
        memo = memo.rstrip("\n") or None
    return Candidate(symbol=sym, memo=memo)


def save_trade(session_id: str, trade: Trade) -> None:
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg = load(session_id)
    if agg is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg.trade = trade
    _write_session_json(dir_path, agg)


def save_final_decision(session_id: str, fd: FinalDecision) -> None:
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg = load(session_id)
    if agg is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg.final_decision = fd
    _write_session_json(dir_path, agg)


def save_drawings(session_id: str, drawings: list[Drawing]) -> None:
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg = load(session_id)
    if agg is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg.drawings = drawings
    _write_session_json(dir_path, agg)


def append_holding_memo(session_id: str, memo: HoldingMemo) -> None:
    dir_path = io.get_dir(session_id)
    if dir_path is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg = load(session_id)
    if agg is None:
        raise FileNotFoundError(f"session not found: {session_id}")
    agg.holding_memos = list(agg.holding_memos) + [memo]
    _write_session_json(dir_path, agg)


def rename_dir(session_id: str) -> Path | None:
    """meta.name / trade.symbol / final_decision.has_entry に基づいてディレクトリ名を再計算し rename。"""
    dir_path = io.get_dir(session_id)
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
    new_name = io.build_dir_name(agg.meta, symbol_part)
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
    io.register_index(session_id, new_path)
    return new_path


def next_drawing_id(session_id: str) -> int:
    """既存描画から最大 id を取り出して +1 を返す。"""
    agg = load(session_id)
    if agg is None or not agg.drawings:
        return 1
    return max(d.id for d in agg.drawings) + 1
