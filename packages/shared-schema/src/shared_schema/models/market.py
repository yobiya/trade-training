"""市場データキャッシュ・経済指標テーブル。"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from shared_schema.base import Base


class Ohlc(Base):
    """OHLC キャッシュ(TF 別キャッシュ)。

    `M5` は provider(MT5 等)から直接取得した値を保存する。
    上位足(`M15` / `H1` / `H4` / `D1` / `W1` / `MN1`)は M5 から resample した
    結果を保存して、再 resample のコストを回避する。

    PK は (symbol, timeframe, timestamp, source) の 4 タプル。
    """

    __tablename__ = "ohlc"

    symbol: Mapped[str] = mapped_column(String(20), primary_key=True)
    timeframe: Mapped[str] = mapped_column(String(8), primary_key=True)  # 'M5' | 'M15' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN1'
    timestamp: Mapped[datetime] = mapped_column(DateTime, primary_key=True)  # UTC, naive in DB
    source: Mapped[str] = mapped_column(String(20), primary_key=True)  # 'mt5', 'dukascopy'
    open: Mapped[float] = mapped_column(Float)
    high: Mapped[float] = mapped_column(Float)
    low: Mapped[float] = mapped_column(Float)
    close: Mapped[float] = mapped_column(Float)
    volume: Mapped[int] = mapped_column(BigInteger)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)  # UTC, naive in DB


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
