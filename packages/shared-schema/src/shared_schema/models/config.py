"""設定・口座テーブル。"""
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from shared_schema.base import Base

# 初期対象銘柄(仕様書 §2.8: FX 28 ペア + 商品 7 銘柄)
DEFAULT_SYMBOLS = [
    # FX 主要(seed が小さい初回起動時に最低限載せる)
    "USDJPY", "EURUSD", "GBPUSD", "AUDUSD", "EURJPY", "GBPJPY", "AUDJPY", "EURGBP",
    # 商品(仕様書 §2.8): 貴金属 / 暗号通貨 / 株価指数
    "XAUUSD", "XAGUSD",
    "BTCUSD", "ETHUSD",
    "US30", "NAS100", "JP225",
]

# 仕様書 §7.2.3 メモ見出しテンプレートはリポジトリ内 Markdown ファイル
# (`data/memo-templates/{candidate,session-note}.md`)で管理する。DB には保存しない。

# 初期スプレッド暫定値(pips)。MT5 デモ接続後に実測値で上書き(仕様書 3章)。
# 商品は broker 慣行ベースの暫定値(仕様書 §3.1 pip サイズ table と整合)。
DEFAULT_SPREADS = {
    "USDJPY": 1.0,
    "EURUSD": 0.6,
    "GBPUSD": 1.2,
    "AUDUSD": 1.0,
    "EURJPY": 1.4,
    "GBPJPY": 2.0,
    "AUDJPY": 1.5,
    "EURGBP": 1.0,
    # 商品(暫定値、ユーザーが MT5 接続後に上書きする前提)
    "XAUUSD": 3.0,   # $0.30 / 0.1
    "XAGUSD": 3.0,   # $0.030 / 0.01
    "BTCUSD": 20.0,  # $20 / 1.0
    "ETHUSD": 15.0,  # $1.50 / 0.1
    "US30": 2.0,
    "NAS100": 2.0,
    "JP225": 10.0,
}

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
