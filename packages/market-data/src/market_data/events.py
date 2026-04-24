"""経済指標の取得・保存(仕様書 §5.4 / §16 Phase 2c)。

MT5 の経済カレンダーは Python API で直接取得できないため、MQL5 側の
`tools/mql5/EconomicCalendarExport.mq5` で書き出した CSV を取り込む。

CSV 形式:
    event_time,currency,name,importance,actual,forecast,previous
    2024-01-15T13:30:00Z,USD,CPI m/m,3,0.2,0.3,0.3
"""
from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.dialects.sqlite import insert

from shared_schema.database import get_session
from shared_schema.models.market import EconomicEvent


_UPSERT_CHUNK_SIZE = 500


def _parse_float(s: str) -> float | None:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_time(s: str) -> datetime:
    """ISO 8601 UTC 文字列を naive UTC datetime に変換する(SQLite 保存用)。"""
    s = s.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _read_csv(path: Path) -> list[dict]:
    """CSV を読んで辞書リストに変換する。"""
    rows: list[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for raw in reader:
            try:
                event_time = _parse_time(raw["event_time"])
                importance = int(raw["importance"])
            except (KeyError, ValueError):
                continue
            currency = (raw.get("currency") or "").strip().upper()
            name = (raw.get("name") or "").strip()
            if not currency or not name:
                continue

            actual = _parse_float(raw.get("actual", ""))
            forecast = _parse_float(raw.get("forecast", ""))
            previous = _parse_float(raw.get("previous", ""))
            surprise = actual - forecast if (actual is not None and forecast is not None) else None

            rows.append({
                "event_time": event_time,
                "currency": currency,
                "name": name,
                "importance": importance,
                "actual": actual,
                "forecast": forecast,
                "previous": previous,
                "surprise": surprise,
                "source": "mt5",
            })
    return rows


def update_events(csv_path: str | Path) -> int:
    """CSV から経済指標を読み込み `economic_events` に upsert する。件数を返す。

    Unique キーは (event_time, currency, name)。同じキーの行は後から来た値で上書き。
    """
    path = Path(csv_path)
    if not path.exists():
        raise FileNotFoundError(f"経済指標 CSV が見つかりません: {path}")

    rows = _read_csv(path)
    if not rows:
        return 0

    with next(get_session()) as session:
        for i in range(0, len(rows), _UPSERT_CHUNK_SIZE):
            chunk = rows[i : i + _UPSERT_CHUNK_SIZE]
            stmt = insert(EconomicEvent).values(chunk)
            stmt = stmt.on_conflict_do_update(
                index_elements=["event_time", "currency", "name"],
                set_={
                    "importance": stmt.excluded.importance,
                    "actual": stmt.excluded.actual,
                    "forecast": stmt.excluded.forecast,
                    "previous": stmt.excluded.previous,
                    "surprise": stmt.excluded.surprise,
                    "source": stmt.excluded.source,
                },
            )
            session.execute(stmt)
        session.commit()

    return len(rows)
