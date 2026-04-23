"""設定・口座テーブル。"""
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from shared_schema.base import Base

# 初期対象銘柄(仕様書 2.8)
DEFAULT_SYMBOLS = ["USDJPY", "EURUSD", "GBPUSD", "AUDUSD", "EURJPY", "GBPJPY", "AUDJPY", "EURGBP"]

# 仕様書 §7.2.3 メモ見出しテンプレート(既定値)
DEFAULT_CANDIDATE_MEMO_TEMPLATE = """## チャート観察(TF・トレンド・形状)

## サポレジ・水準

## 根拠 / 狙いどころ

## SL / TP の考え
"""

DEFAULT_SESSION_NOTE_TEMPLATE = """## 相場観・通貨強弱

## 銘柄比較

## シナリオ(メイン / 代替)

## スタイル選定

## 判断

## 決済・振り返り
"""

# 初期スプレッド暫定値(pips)。MT5 デモ接続後に実測値で上書き(仕様書 3章)。
DEFAULT_SPREADS = {
    "USDJPY": 1.0,
    "EURUSD": 0.6,
    "GBPUSD": 1.2,
    "AUDUSD": 1.0,
    "EURJPY": 1.4,
    "GBPJPY": 2.0,
    "AUDJPY": 1.5,
    "EURGBP": 1.0,
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
    # 仕様書 §7.2.3 メモ見出しテンプレート(新規メモ作成時の初期値、ユーザー編集可)
    candidate_memo_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    session_note_template: Mapped[str | None] = mapped_column(Text, nullable=True)
    memo_template_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
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
