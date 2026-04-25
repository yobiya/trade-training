"""仕様書 §7.2.3 メモ見出しテンプレートの読み込み(リポジトリ内 Markdown ファイル管理)。

DB に保存せず `data/memo-templates/{candidate,session-note}.md` を起動時に
1 回読み込んでメモリ保持する。編集はテキストエディタ + git で行う(個人運用)。
ファイルが存在しない・空の場合はテンプレ未挿入として扱う。
"""
from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


_CANDIDATE_FILENAME = "candidate.md"
_SESSION_NOTE_FILENAME = "session-note.md"


# モジュールレベルキャッシュ(load_memo_templates() で初期化)
_candidate_template: str | None = None
_session_note_template: str | None = None
_loaded = False


def _resolve_templates_dir() -> Path:
    """環境変数 MEMO_TEMPLATES_DIR があればそれを使う。

    無ければ backend モジュールから推定: `<repo_root>/data/memo-templates`。
    backend の src は `apps/trade-trainer/backend/src/...` の階層なので 4 つ上がリポジトリルート。
    """
    env_dir = os.environ.get("MEMO_TEMPLATES_DIR")
    if env_dir:
        return Path(env_dir)
    here = Path(__file__).resolve()
    # services/memo_templates.py → services → trade_trainer_backend → src → backend → trade-trainer → apps → repo
    repo_root = here.parents[6]
    return repo_root / "data" / "memo-templates"


def _read_template(path: Path) -> str | None:
    if not path.exists():
        logger.info("memo template not found: %s (skip insertion)", path)
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning("failed to read memo template %s: %s", path, e)
        return None
    text = text.strip()
    return text if text else None


def load_memo_templates() -> None:
    """起動時に 1 回呼び出し、メモリへ読み込む。"""
    global _candidate_template, _session_note_template, _loaded
    base = _resolve_templates_dir()
    _candidate_template = _read_template(base / _CANDIDATE_FILENAME)
    _session_note_template = _read_template(base / _SESSION_NOTE_FILENAME)
    _loaded = True
    logger.info(
        "memo templates loaded from %s (candidate=%s, session_note=%s)",
        base,
        "ok" if _candidate_template else "none",
        "ok" if _session_note_template else "none",
    )


def get_candidate_template() -> str | None:
    """銘柄別メモの初期テンプレ。ファイル無し / 空 / 未ロードなら None。"""
    if not _loaded:
        load_memo_templates()
    return _candidate_template


def get_session_note_template() -> str | None:
    """横断メモの初期テンプレ。ファイル無し / 空 / 未ロードなら None。"""
    if not _loaded:
        load_memo_templates()
    return _session_note_template
