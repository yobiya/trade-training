"""低レベル file I/O + ディレクトリ index(2026-04-29 で session_store.py から分離)。

公開 API は持たない(`session_store.__init__` から内部利用される)。
"""
from __future__ import annotations

import json
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from trade_trainer_backend.services.session_models import Candidate, SessionMeta
from trade_trainer_backend.utils.datetime import ensure_aware_utc
from trade_trainer_backend.utils.json_io import read_json, read_text

logger = logging.getLogger(__name__)


SAFE_NAME_RE = re.compile(r'[/\\:\*\?"<>|\x00-\x1f]')

# Dropbox 等が生成する競合ファイルのパターン(一覧スキャンで除外)
_CONFLICT_PATTERNS = ("Conflicted copy", ".conflict")


# ============================================================================
# パス解決 / 命名
# ============================================================================

def _jst_offset() -> timedelta:
    return timedelta(hours=9)


def resolve_root() -> Path:
    env = os.environ.get("SESSIONS_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    # apps/trade-trainer/backend/src/trade_trainer_backend/services/session_store/io.py
    # parents[0]=session_store, [1]=services, [2]=trade_trainer_backend, [3]=src,
    # [4]=backend, [5]=trade-trainer, [6]=apps, [7]=repo root
    repo_root = here.parents[7]
    return repo_root / "data" / "sessions"


def is_conflict_name(name: str) -> bool:
    return any(p in name for p in _CONFLICT_PATTERNS)


def sanitize_dir_part(s: str | None, fallback: str) -> str:
    if not s:
        return fallback
    s = SAFE_NAME_RE.sub("-", s).strip(" -.")
    if not s or s in (".", ".."):
        return fallback
    return s


def build_dir_name(meta: SessionMeta, symbol_part: str | None) -> str:
    """`{YYYYMMDD-HHMM}-{symbol}-{name}` 形式(JST)。"""
    pa = ensure_aware_utc(meta.presented_at)
    jst = pa.astimezone(timezone(_jst_offset()))
    date_part = jst.strftime("%Y%m%d-%H%M")
    sym = sanitize_dir_part(symbol_part, "pending")
    name_part = sanitize_dir_part(meta.name, "untitled")
    return f"{date_part}-{sym}-{name_part}"


def new_session_id(presented_at: datetime) -> str:
    """`YYYYMMDD-HHMM-xxxx` 形式の不変識別子。"""
    pa = ensure_aware_utc(presented_at)
    jst = pa.astimezone(timezone(_jst_offset()))
    suffix = secrets.token_hex(2)  # 4 hex chars
    return f"{jst.strftime('%Y%m%d-%H%M')}-{suffix}"


# ============================================================================
# id → Path インデックス
# ============================================================================

_index: dict[str, Path] = {}


def reindex() -> None:
    """セッションディレクトリ全走査して id → Path のインデックスを再構築する。"""
    root = resolve_root()
    seen: dict[str, Path] = {}
    if not root.exists():
        _index.clear()
        return
    for d in sorted(root.iterdir()):
        if not d.is_dir():
            continue
        if is_conflict_name(d.name):
            continue
        meta_path = d / "session.json"
        if not meta_path.exists():
            continue
        data = read_json(meta_path)
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
    """id からディレクトリを取得。消えていたら再インデックスして再試行。"""
    p = _index.get(session_id)
    if p is not None and p.exists():
        return p
    reindex()
    p = _index.get(session_id)
    return p if p is not None and p.exists() else None


def register_index(session_id: str, path: Path) -> None:
    """新規 / rename 後に id→path を登録する(`__init__` 経由)。"""
    _index[session_id] = path


def all_indexed_ids() -> list[str]:
    return list(_index.keys())


# ============================================================================
# 旧分割形式の読み出し helper / 統合移行後の削除
# ============================================================================

def delete_legacy_files(dir_path: Path) -> None:
    """次回 save 時、統合形式へ移行した後の旧個別ファイル群を削除する。"""
    for name in ("trade.json", "final_decision.json", "drawings.json", "holding_memos.jsonl"):
        p = dir_path / name
        if p.exists():
            try:
                p.unlink()
            except OSError as e:
                logger.warning("failed to remove legacy file %s: %s", p, e)


def read_legacy_trade_dict(dir_path: Path) -> Any | None:
    return read_json(dir_path / "trade.json")


def read_legacy_fd_dict(dir_path: Path) -> Any | None:
    return read_json(dir_path / "final_decision.json")


def read_legacy_drawings_list(dir_path: Path) -> list[Any]:
    data = read_json(dir_path / "drawings.json")
    return data if isinstance(data, list) else []


def read_legacy_holding_memos_jsonl(dir_path: Path) -> list[Any]:
    """`holding_memos.jsonl` の各行を JSON として読み出す(旧分割形式のフォーマット)。"""
    p = dir_path / "holding_memos.jsonl"
    if not p.exists():
        return []
    out: list[Any] = []
    try:
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
                out.append(rec)
            except json.JSONDecodeError:
                continue
    except OSError:
        return []
    return out


# ============================================================================
# candidates/{symbol}.md 読み出し
# ============================================================================

def read_candidates(dir_path: Path) -> list[Candidate]:
    cdir = dir_path / "candidates"
    if not cdir.exists():
        return []
    out: list[Candidate] = []
    for p in sorted(cdir.glob("*.md")):
        if is_conflict_name(p.name):
            continue
        symbol = p.stem.upper()
        memo = read_text(p)
        if memo is not None:
            memo = memo.rstrip("\n")
            if not memo:
                memo = None
        out.append(Candidate(symbol=symbol, memo=memo))
    return out
