"""仕様書 §17 セッション情報のファイル管理用 dataclass。

ファイル I/O 層(`session_store/`)が読み書きするドメインモデル。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass
class SessionMeta:
    """data/sessions/{dir}/session.json"""
    id: str                                    # 不変識別子(YYYYMMDD-HHMM-xxxx)
    name: str | None
    started_at: datetime
    presented_at: datetime
    current_position: datetime
    mode: str                                  # 'training' | 'real'
    settled_at: datetime | None                # null = 進行中、値あり = 決着済み
    indicator_config_id: int | None = None


@dataclass
class Candidate:
    """candidates/{symbol}.md。memo は本文 Markdown。"""
    symbol: str
    memo: str | None                           # ファイル本文(空ファイルなら None)


@dataclass
class Trade:
    """trade.json。エントリー時のみ存在。"""
    id: str
    symbol: str
    direction: str                             # 'buy' | 'sell'
    entry_tf: str                              # §5.1.5 エントリー時のフォーカス TF (M5 / M15 / ... / MN1)
    entry_time: datetime
    entry_price: float
    sl: float | None
    tp: float | None
    exit_time: datetime | None
    exit_price: float | None
    exit_reason: str | None                    # 'tp' | 'sl' | 'manual'
    pips_pnl: float | None
    amount_pnl: float | None
    lot: float | None
    mt5_order_id: int | None
    created_at: datetime
    pip_size: float | None = None              # §3.1 エントリー時 snapshot(履歴改竄防止)


@dataclass
class FinalDecision:
    """final_decision.json。見送り確定時のみ存在。"""
    has_entry: bool
    skip_reason: str | None


@dataclass
class HoldingMemo:
    """holding_memos.jsonl の 1 エントリ。"""
    timestamp: datetime
    memo: str


@dataclass
class Drawing:
    """drawings.json の 1 エントリ。"""
    id: int
    symbol: str | None
    kind: str                                  # 'line' | 'trendline' | 'fibonacci' | 'wave_label'
    data: dict[str, Any]
    label: str | None
    timeframe: str | None
    visible_on_timeframes: list[str] | None


@dataclass
class SessionAggregate:
    """1 セッションのファイル群を読み込んだ集約。"""
    meta: SessionMeta
    note: str | None                           # note.md 本文
    candidates: list[Candidate] = field(default_factory=list)
    trade: Trade | None = None
    final_decision: FinalDecision | None = None
    drawings: list[Drawing] = field(default_factory=list)
    holding_memos: list[HoldingMemo] = field(default_factory=list)


def is_settled(s: SessionAggregate) -> bool:
    """§4.2.1 状態モデル判定。"""
    return s.meta.settled_at is not None


def has_entry(s: SessionAggregate) -> bool:
    return s.trade is not None


def is_active_holding(s: SessionAggregate) -> bool:
    """保有中(エントリー済 + 未決済)。"""
    return s.trade is not None and s.trade.exit_time is None


def is_settle_eligible(s: SessionAggregate) -> bool:
    """決着遷移条件(§4.2.2):トレード決済済み or 見送り確定済み。"""
    if s.trade is not None and s.trade.exit_time is not None:
        return True
    if s.final_decision is not None and not s.final_decision.has_entry:
        return True
    return False
