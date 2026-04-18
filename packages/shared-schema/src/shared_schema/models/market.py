"""市場データキャッシュ・経済指標テーブル。"""
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared_schema.base import Base


class OhlcM5(Base):
    """M5 OHLC キャッシュ。上位足は動的集約で生成するため M5 のみ保存。"""

    __tablename__ = "ohlc_m5"

    symbol: Mapped[str] = mapped_column(String(20), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, primary_key=True)  # UTC
    source: Mapped[str] = mapped_column(String(20), primary_key=True)  # 'mt5', 'dukascopy'
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[int] = mapped_column(BigInteger)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)  # UTC


class EconomicEvent(Base):
    """経済指標。market-data CLI の日次バッチで取得・更新。"""

    __tablename__ = "economic_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_time: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)  # UTC
    currency: Mapped[str] = mapped_column(String(10), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    importance: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-3
    actual: Mapped[float | None] = mapped_column(Float, nullable=True)
    forecast: Mapped[float | None] = mapped_column(Float, nullable=True)
    previous: Mapped[float | None] = mapped_column(Float, nullable=True)
    surprise: Mapped[float | None] = mapped_column(Float, nullable=True)  # actual - forecast
    source: Mapped[str] = mapped_column(String(20), default="mt5")

    __table_args__ = (
        UniqueConstraint("event_time", "currency", "name", name="uq_economic_event"),
    )
