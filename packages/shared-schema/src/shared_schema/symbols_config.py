"""仕様書 §2.4 / §2.8 / §3 / §3.1: `config/symbols.toml` 単一情報源の load 層。

銘柄ごとの情報(category / spread_pips / pip_size_fallback / aliases / default_active)を
`config/symbols.toml` から読み出す。新 broker / 新銘柄 / alias 追加は toml 編集だけで完結する。

呼び出し側(market-data / backend services / shared-schema seeds)は `get_symbols_config()` を
呼んでシングルトンを取得する。最初の呼び出しで自動 load、以降はメモリキャッシュ。
"""
from __future__ import annotations

import logging
import sys
import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

log = logging.getLogger(__name__)

SymbolCategory = Literal["fx", "metal", "crypto_btc", "crypto_eth", "index"]
_VALID_CATEGORIES: frozenset[str] = frozenset(
    ["fx", "metal", "crypto_btc", "crypto_eth", "index"]
)


@dataclass(frozen=True)
class SymbolDef:
    """1 銘柄の定義。`config/symbols.toml` の `[symbols.X]` 1 ブロックに対応。"""

    code: str  # 内部標準名 (USDJPY / XAUUSD など)
    category: SymbolCategory
    spread_pips: float
    pip_size_fallback: float
    aliases: tuple[str, ...]  # broker 候補(完全一致 → startswith マッチ順)。空なら code を試す
    default_active: bool

    def aliases_or_self(self) -> list[str]:
        """alias が空なら code を返す(`_resolve_symbol` で扱いやすい形)。"""
        return list(self.aliases) if self.aliases else [self.code]


@dataclass(frozen=True)
class SymbolsConfig:
    """全銘柄の集約。順序は toml 上の宣言順を保つ。"""

    symbols: tuple[SymbolDef, ...]
    by_code: dict[str, SymbolDef] = field(default_factory=dict)

    def default_active_codes(self) -> list[str]:
        return [s.code for s in self.symbols if s.default_active]

    def default_spreads(self) -> dict[str, float]:
        return {s.code: s.spread_pips for s in self.symbols if s.default_active}


_CONFIG: SymbolsConfig | None = None
_DEFAULT_PATH: Path | None = None


def _default_config_path() -> Path:
    """`config/symbols.toml` のデフォルトパスを返す。

    `__file__` から 5 階層上(packages/shared-schema/src/shared_schema/symbols_config.py
    → repo root)を取る。editable install (uv sync) を前提とする。
    """
    return Path(__file__).resolve().parents[4] / "config" / "symbols.toml"


def configure_symbols_path(path: Path) -> None:
    """テスト等で異なる toml を読み込むためのフック。"""
    global _DEFAULT_PATH, _CONFIG
    _DEFAULT_PATH = path
    _CONFIG = None  # 次回 get で再 load


def _parse_toml(path: Path) -> SymbolsConfig:
    if not path.exists():
        raise FileNotFoundError(f"symbols.toml not found: {path}")
    with open(path, "rb") as f:
        data = tomllib.load(f)
    raw = data.get("symbols", {})
    if not isinstance(raw, dict):
        raise ValueError(f"symbols.toml: top-level [symbols] must be a table, got {type(raw)}")

    sds: list[SymbolDef] = []
    for code, props in raw.items():
        if not isinstance(props, dict):
            log.warning("[symbols_config] skip %s: not a table", code)
            continue
        category = str(props.get("category", "fx"))
        if category not in _VALID_CATEGORIES:
            log.warning(
                "[symbols_config] %s: unknown category '%s', falling back to 'fx'",
                code, category,
            )
            category = "fx"
        sds.append(SymbolDef(
            code=str(code).upper(),
            category=category,  # type: ignore[arg-type]
            spread_pips=float(props.get("spread_pips", 1.0)),
            pip_size_fallback=float(props.get("pip_size_fallback", 0.0001)),
            aliases=tuple(str(a) for a in props.get("aliases", [])),
            default_active=bool(props.get("default_active", True)),
        ))

    by_code = {s.code: s for s in sds}
    return SymbolsConfig(symbols=tuple(sds), by_code=by_code)


def load_symbols_config(path: Path | None = None) -> SymbolsConfig:
    """toml を load して SymbolsConfig を返す。`path` 省略時はデフォルトパス + キャッシュ。"""
    global _CONFIG
    if path is not None:
        return _parse_toml(path)
    if _CONFIG is not None:
        return _CONFIG
    target = _DEFAULT_PATH or _default_config_path()
    cfg = _parse_toml(target)
    _CONFIG = cfg
    log.info("[symbols_config] loaded %d symbols from %s", len(cfg.symbols), target)
    return cfg


def get_symbols_config() -> SymbolsConfig:
    """シングルトン取得(load 済みでなければ自動 load)。"""
    return load_symbols_config()
