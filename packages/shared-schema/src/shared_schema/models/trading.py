"""トレード関連テーブル。"""
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from shared_schema.base import Base


class TradingStyle(Base):
    """ユーザー定義のトレードスタイル(仕様書 8章)。"""

    __tablename__ = "trading_styles"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # 'short', 'mid', 'news', etc.
    name: Mapped[str] = mapped_column(String(50))
    primary_timeframe: Mapped[str] = mapped_column(String(10))  # 'M5', 'H1', etc.
    expected_hold_time: Mapped[str] = mapped_column(String(50))
    expected_rr: Mapped[str] = mapped_column(String(20))  # "1:1.5"
    typical_sl_pips: Mapped[str] = mapped_column(String(30))  # "10~20"
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    trades: Mapped[list["Trade"]] = relationship("Trade", back_populates="style")


class TradeSession(Base):
    """1回のトレード判断セッション。training では1つずつ、real では並行稼働(仕様書 4.2/12.7)。"""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # UUID
    started_at: Mapped[datetime] = mapped_column(DateTime)  # UTC
    presented_at: Mapped[datetime] = mapped_column(DateTime)  # UTC: 最初に提示した日時(固定)
    current_position: Mapped[datetime] = mapped_column(DateTime)  # UTC: 現在の足位置(足送りで更新)
    mode: Mapped[str] = mapped_column(String(10))  # "training" | "real"
    time_filter: Mapped[Any] = mapped_column(JSON, nullable=True)  # {sessions, days, date_range}
    is_suspended: Mapped[bool] = mapped_column(Boolean, default=False)

    candidates: Mapped[list["SessionCandidate"]] = relationship(
        "SessionCandidate", back_populates="session", cascade="all, delete-orphan"
    )
    final_decision: Mapped["SessionFinalDecision | None"] = relationship(
        "SessionFinalDecision", back_populates="session", uselist=False, cascade="all, delete-orphan"
    )
    trades: Mapped[list["Trade"]] = relationship(
        "Trade", back_populates="session", cascade="all, delete-orphan"
    )
    drawings: Mapped[list["Drawing"]] = relationship(
        "Drawing", back_populates="session", cascade="all, delete-orphan"
    )


class SessionCandidate(Base):
    """銘柄選定画面でウォッチリストに追加した候補(仕様書 6.2 / 9.1 層1)。"""

    __tablename__ = "session_candidates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    symbol: Mapped[str] = mapped_column(String(20))
    add_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_selected: Mapped[bool] = mapped_column(Boolean, default=False)  # 最終選定されたか
    skip_reason: Mapped[str | None] = mapped_column(Text, nullable=True)  # 見送り理由
    followup_ohlc: Mapped[Any] = mapped_column(JSON, nullable=True)  # {10: [...], 50: [...], 200: [...]}
    eval_tags: Mapped[Any] = mapped_column(JSON, nullable=True)  # list[str]

    session: Mapped["TradeSession"] = relationship("TradeSession", back_populates="candidates")


class SessionFinalDecision(Base):
    """最終的に選定(またはスキップ)した銘柄の記録(仕様書 9.1 層2)。"""

    __tablename__ = "session_final_decisions"

    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"), primary_key=True)
    symbol: Mapped[str | None] = mapped_column(String(20), nullable=True)
    has_entry: Mapped[bool] = mapped_column(Boolean, default=False)
    skip_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    considered_styles: Mapped[Any] = mapped_column(JSON, nullable=True)  # list[str]
    followup_ohlc: Mapped[Any] = mapped_column(JSON, nullable=True)
    eval_tags: Mapped[Any] = mapped_column(JSON, nullable=True)  # list[str]

    session: Mapped["TradeSession"] = relationship("TradeSession", back_populates="final_decision")


class Trade(Base):
    """エントリーしたトレード(仕様書 17章 Trade)。"""

    __tablename__ = "trades"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # UUID
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    mode: Mapped[str] = mapped_column(String(10))  # "training" | "real"
    symbol: Mapped[str] = mapped_column(String(20), index=True)
    direction: Mapped[str] = mapped_column(String(5))  # "buy" | "sell"
    entry_time: Mapped[datetime] = mapped_column(DateTime, index=True)  # UTC
    entry_price: Mapped[float] = mapped_column(Float)
    sl: Mapped[float] = mapped_column(Float)
    tp: Mapped[float | None] = mapped_column(Float, nullable=True)
    exit_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # UTC
    exit_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    exit_reason: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "tp"|"sl"|"manual"
    pips_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)
    amount_pnl: Mapped[float | None] = mapped_column(Float, nullable=True)  # real のみ
    lot: Mapped[float | None] = mapped_column(Float, nullable=True)  # real のみ
    mt5_order_id: Mapped[int | None] = mapped_column(BigInteger, nullable=True)  # real のみ
    style_id: Mapped[str | None] = mapped_column(ForeignKey("trading_styles.id"), nullable=True)
    style_selection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    followup_ohlc: Mapped[Any] = mapped_column(JSON, nullable=True)  # 後悔指標データ
    created_at: Mapped[datetime] = mapped_column(DateTime)  # UTC

    session: Mapped["TradeSession"] = relationship("TradeSession", back_populates="trades")
    style: Mapped["TradingStyle | None"] = relationship("TradingStyle", back_populates="trades")
    scenario: Mapped["Scenario | None"] = relationship(
        "Scenario", back_populates="trade", uselist=False, cascade="all, delete-orphan"
    )
    holding_memos: Mapped[list["HoldingMemo"]] = relationship(
        "HoldingMemo", back_populates="trade", cascade="all, delete-orphan"
    )


class Scenario(Base):
    """シナリオメモ。Trade と 1対1(仕様書 7章)。"""

    __tablename__ = "scenarios"

    trade_id: Mapped[str] = mapped_column(ForeignKey("trades.id"), primary_key=True)
    environment: Mapped[str | None] = mapped_column(Text, nullable=True)  # 環境認識
    market_view: Mapped[str | None] = mapped_column(Text, nullable=True)  # 相場観
    symbol_reason: Mapped[str | None] = mapped_column(Text, nullable=True)  # 銘柄選定理由
    skipped_candidates: Mapped[str | None] = mapped_column(Text, nullable=True)  # 見送った候補
    event_recognition: Mapped[str | None] = mapped_column(Text, nullable=True)  # 指標認識
    wave_count: Mapped[str | None] = mapped_column(Text, nullable=True)  # 波動カウント
    scenario_main: Mapped[str | None] = mapped_column(Text, nullable=True)  # メインシナリオ
    scenario_alt1: Mapped[str | None] = mapped_column(Text, nullable=True)  # 代替シナリオ1
    scenario_alt2: Mapped[str | None] = mapped_column(Text, nullable=True)  # 代替シナリオ2(任意)
    entry_basis: Mapped[str | None] = mapped_column(Text, nullable=True)  # エントリー根拠
    tags: Mapped[Any] = mapped_column(JSON, nullable=True)  # list[str]
    exit_memo: Mapped[str | None] = mapped_column(Text, nullable=True)  # 決済時メモ
    reflection: Mapped[str | None] = mapped_column(Text, nullable=True)  # 振り返りメモ

    trade: Mapped["Trade"] = relationship("Trade", back_populates="scenario")


class HoldingMemo(Base):
    """保有中の任意気づきメモ(仕様書 12.6)。タイムスタンプ付き複数記録可。"""

    __tablename__ = "holding_memos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trade_id: Mapped[str] = mapped_column(ForeignKey("trades.id"))
    timestamp: Mapped[datetime] = mapped_column(DateTime)  # UTC
    memo: Mapped[str] = mapped_column(Text)

    trade: Mapped["Trade"] = relationship("Trade", back_populates="holding_memos")


class Drawing(Base):
    """チャート上の描画オブジェクト(仕様書 5.3/5.5)。"""

    __tablename__ = "drawings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id"))
    kind: Mapped[str] = mapped_column(String(20))  # "line"|"fibonacci"|"label"|"trendline"
    data: Mapped[Any] = mapped_column(JSON)  # 座標データ(kind ごとに構造が異なる)
    label: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 仕様書 §5.3: 描画時のメイン時間足(マルチ TF 分析で判断根拠の時間軸を後追いするため必須)
    timeframe: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # 仕様書 §5.3: 表示対象時間足の配列(未指定は既定の可視性に従う)
    visible_on_timeframes: Mapped[Any] = mapped_column(JSON, nullable=True)

    session: Mapped["TradeSession"] = relationship("TradeSession", back_populates="drawings")
