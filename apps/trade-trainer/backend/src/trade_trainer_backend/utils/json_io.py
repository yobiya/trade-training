"""JSON 読み書きの共通 helper。

datetime の serialization は I-1 不変条件に従い ISO 8601 + Z 形式に固定する。
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from trade_trainer_backend.utils.datetime import ensure_aware_utc

logger = logging.getLogger(__name__)


def json_default(o: Any) -> Any:
    """`json.dumps` の default 引数。datetime を ISO 8601 + Z に変換する。"""
    if isinstance(o, datetime):
        return ensure_aware_utc(o).isoformat().replace("+00:00", "Z")
    raise TypeError(f"Not JSON serializable: {type(o)}")


def write_json(path: Path, data: Any) -> None:
    """ディレクトリ自動作成 + json.dumps + 単純書き込み。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, default=json_default),
        encoding="utf-8",
    )


def read_json(path: Path) -> Any | None:
    """ファイルが無いか壊れている場合は None を返す(失敗は log.warning)。"""
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("failed to read JSON %s: %s", path, e)
        return None


def read_text(path: Path) -> str | None:
    """ファイルが無いか読めない場合は None を返す(失敗は log.warning)。"""
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning("failed to read text %s: %s", path, e)
        return None


def write_text(path: Path, content: str) -> None:
    """ディレクトリ自動作成 + 単純書き込み(UTF-8)。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
