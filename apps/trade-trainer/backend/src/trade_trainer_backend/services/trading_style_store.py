"""仕様書 §8 トレードスタイルのファイル管理(ver 1.45)。

`data/trading-styles/{id}.md` を起動時に 1 回ロードしてメモリ保持する。
frontmatter にメタ、本文に description。編集はテキストエディタ + git で行う。
ファイル無し / 解析失敗 → そのスタイルは存在しないとして扱う(エラーにしない)。
"""
from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", re.DOTALL)


@dataclass
class TradingStyle:
    id: str
    name: str
    primary_timeframe: str | None
    expected_hold_time: str | None
    expected_rr: str | None
    typical_sl_pips: str | None
    description: str
    is_active: bool


_styles: dict[str, TradingStyle] = {}
_loaded = False


def _resolve_dir() -> Path:
    env = os.environ.get("TRADING_STYLES_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    repo_root = here.parents[6]
    return repo_root / "data" / "trading-styles"


def _parse_md(text: str) -> tuple[dict, str]:
    """frontmatter (YAML) + 本文 を返す。frontmatter 無しなら ({}, full_text)。"""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text.strip()
    fm_raw, body = m.group(1), m.group(2).strip()
    try:
        meta = yaml.safe_load(fm_raw) or {}
        if not isinstance(meta, dict):
            meta = {}
    except yaml.YAMLError as e:
        logger.warning("frontmatter parse error: %s", e)
        meta = {}
    return meta, body


def _load_one(path: Path) -> TradingStyle | None:
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning("failed to read trading style %s: %s", path, e)
        return None
    meta, body = _parse_md(text)
    style_id = path.stem  # ファイル名(拡張子除く)が id
    name = meta.get("name") or style_id
    return TradingStyle(
        id=style_id,
        name=str(name),
        primary_timeframe=_str_or_none(meta.get("primary_timeframe")),
        expected_hold_time=_str_or_none(meta.get("expected_hold_time")),
        expected_rr=_str_or_none(meta.get("expected_rr")),
        typical_sl_pips=_str_or_none(meta.get("typical_sl_pips")),
        description=body,
        is_active=bool(meta.get("is_active", True)),
    )


def _str_or_none(v: object) -> str | None:
    if v is None:
        return None
    return str(v)


def load_trading_styles() -> None:
    """起動時に 1 回呼び出し、メモリへ読み込む。"""
    global _loaded
    _styles.clear()
    base = _resolve_dir()
    if not base.exists():
        logger.info("trading styles dir not found: %s (no styles loaded)", base)
        _loaded = True
        return
    for p in sorted(base.glob("*.md")):
        s = _load_one(p)
        if s is None:
            continue
        _styles[s.id] = s
    _loaded = True
    logger.info("trading styles loaded from %s: %d entries", base, len(_styles))


def _ensure_loaded() -> None:
    if not _loaded:
        load_trading_styles()


def list_styles(include_inactive: bool = False) -> list[TradingStyle]:
    _ensure_loaded()
    rows = list(_styles.values())
    if not include_inactive:
        rows = [s for s in rows if s.is_active]
    rows.sort(key=lambda s: s.id)
    return rows


def get_style(style_id: str) -> TradingStyle | None:
    _ensure_loaded()
    return _styles.get(style_id)
