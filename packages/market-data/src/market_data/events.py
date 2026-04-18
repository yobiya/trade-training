"""経済指標の取得・保存(Phase 2c で本実装、Phase 1 はスタブ)。"""
from datetime import datetime


def update_events(from_dt: datetime | None = None, to_dt: datetime | None = None) -> int:
    """MT5 経済カレンダーから指標を取得して DB に保存する。保存件数を返す。

    Phase 1 はスタブ。Phase 2c で MT5 calendar_value_history() を実装する。
    """
    raise NotImplementedError("events.update_events は Phase 2c で実装します。")
