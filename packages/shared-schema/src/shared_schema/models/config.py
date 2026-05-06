"""設定・口座テーブル。"""
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from shared_schema.base import Base

# 初期対象銘柄 / 初期スプレッドは `config/symbols.toml` を真実の所有者とする(仕様書 §2.8 / §3)。
# `seeds.py` から `default_symbols()` / `default_spreads()` を呼んで Setting に流す。


def default_symbols() -> list[str]:
    """`config/symbols.toml` で `default_active = true` の銘柄コードを返す(仕様書 §2.8)。"""
    from shared_schema.symbols_config import get_symbols_config
    return get_symbols_config().default_active_codes()


def default_spreads() -> dict[str, float]:
    """`config/symbols.toml` の `spread_pips` を `{code: spread}` で返す(仕様書 §3)。"""
    from shared_schema.symbols_config import get_symbols_config
    return get_symbols_config().default_spreads()


# 仕様書 §7.2.3 メモ見出しテンプレートはリポジトリ内 Markdown ファイル
# (`data/memo-templates/{candidate,session-note}.md`)で管理する。DB には保存しない。

# 時間軸プリセット初期値
DEFAULT_TIMEFRAME_PRESETS = [
    {"name": "短期", "timeframes": ["M5", "M15", "H1", "H4"]},
    {"name": "中期", "timeframes": ["M15", "H1", "H4", "D1"]},
    {"name": "スイング", "timeframes": ["H1", "H4", "D1"]},
]


class Setting(Base):
    """アプリ設定(単一ユーザーのため常に id=1 の1行のみ)。"""

    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    symbols: Mapped[Any] = mapped_column(JSON)  # list[str]
    spreads: Mapped[Any] = mapped_column(JSON)  # dict[str, float]
    timeframe_presets: Mapped[Any] = mapped_column(JSON)  # list[dict]
    time_filter_presets: Mapped[Any] = mapped_column(JSON, nullable=True)  # list[dict]
    event_importance_threshold: Mapped[int] = mapped_column(Integer, default=3)  # 星3以上
    event_currencies: Mapped[Any] = mapped_column(JSON, nullable=True)  # list[str] | None = チャートペアに連動
    event_shading_before_min: Mapped[int] = mapped_column(Integer, default=5)
    event_shading_after_min: Mapped[int] = mapped_column(Integer, default=30)
    risk_percent: Mapped[float | None] = mapped_column(Float, nullable=True)  # 1トレード許容損失%
    risk_amount: Mapped[float | None] = mapped_column(Float, nullable=True)  # 1トレード許容損失額
    # §7.2.3 メモ見出しテンプレートはリポジトリ内 Markdown ファイル
    # (`data/memo-templates/{candidate,session-note}.md`)で管理するため、
    # ここには保存しない(DB と二重管理を避ける)。
    updated_at: Mapped[datetime] = mapped_column(DateTime)  # UTC


class Account(Base):
    """MT5 口座情報(real モード用、MT5 から定期同期)。"""

    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    balance: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(10))
    leverage: Mapped[int] = mapped_column(Integer)
    margin_free: Mapped[float] = mapped_column(Float)
    synced_at: Mapped[datetime] = mapped_column(DateTime)  # UTC
