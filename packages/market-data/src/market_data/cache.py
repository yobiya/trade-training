"""SQLite キャッシュ層 - OhlcM5 テーブルの読み書き。"""
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from shared_schema.models.market import OhlcM5


def get_cached_ohlc(
    session: Session,
    symbol: str,
    from_dt: datetime,
    to_dt: datetime,
    source: str = "mt5",
) -> pd.DataFrame:
    """キャッシュから M5 OHLC を取得して UTC インデックスの DataFrame で返す。"""
    stmt = (
        select(OhlcM5)
        .where(
            OhlcM5.symbol == symbol,
            OhlcM5.source == source,
            OhlcM5.timestamp >= from_dt,
            OhlcM5.timestamp <= to_dt,
        )
        .order_by(OhlcM5.timestamp)
    )
    rows = session.scalars(stmt).all()

    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    data = [
        {
            "timestamp": r.timestamp.replace(tzinfo=timezone.utc)
            if r.timestamp.tzinfo is None
            else r.timestamp,
            "open": r.open,
            "high": r.high,
            "low": r.low,
            "close": r.close,
            "volume": r.volume,
        }
        for r in rows
    ]
    return pd.DataFrame(data).set_index("timestamp")


# SQLite は 1 ステートメントあたりのバインド変数を制限(古いビルドで 999、新ビルドで 32766)。
# 1 レコード 9 カラムを掛けても安全な範囲にチャンクする。
_INSERT_CHUNK_SIZE = 500


def store_ohlc(
    session: Session,
    df: pd.DataFrame,
    symbol: str,
    source: str = "mt5",
) -> int:
    """DataFrame を OhlcM5 テーブルに upsert する。挿入行数を返す。"""
    if df.empty:
        return 0

    now = datetime.now(timezone.utc)
    records = [
        {
            "symbol": symbol,
            "timestamp": ts.to_pydatetime().replace(tzinfo=None),  # SQLite は naive で保存
            "source": source,
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": int(row["volume"]),
            "fetched_at": now.replace(tzinfo=None),
        }
        for ts, row in df.iterrows()
    ]

    for i in range(0, len(records), _INSERT_CHUNK_SIZE):
        chunk = records[i : i + _INSERT_CHUNK_SIZE]
        stmt = insert(OhlcM5).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=["symbol", "timestamp", "source"],
            set_={
                "open": stmt.excluded.open,
                "high": stmt.excluded.high,
                "low": stmt.excluded.low,
                "close": stmt.excluded.close,
                "volume": stmt.excluded.volume,
                "fetched_at": stmt.excluded.fetched_at,
            },
        )
        session.execute(stmt)
    session.commit()
    return len(records)


def get_cached_extremes(
    session: Session,
    symbol: str,
    source: str = "mt5",
) -> tuple[datetime, datetime] | None:
    """キャッシュ内の最古・最新タイムスタンプを返す。データなしなら None。"""
    from sqlalchemy import func

    row = session.execute(
        select(
            func.min(OhlcM5.timestamp),
            func.max(OhlcM5.timestamp),
        ).where(OhlcM5.symbol == symbol, OhlcM5.source == source)
    ).one()

    if row[0] is None:
        return None

    oldest = row[0].replace(tzinfo=timezone.utc) if row[0].tzinfo is None else row[0]
    latest = row[1].replace(tzinfo=timezone.utc) if row[1].tzinfo is None else row[1]
    return oldest, latest
