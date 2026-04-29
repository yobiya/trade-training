"""SQLite キャッシュ層 - Ohlc テーブル(TF 別)の読み書き。"""
import logging
from datetime import datetime, timezone

import pandas as pd
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from shared_schema.models.market import Ohlc

log = logging.getLogger(__name__)


def get_cached_ohlc(
    session: Session,
    symbol: str,
    timeframe: str,
    from_dt: datetime,
    to_dt: datetime,
    source: str = "mt5",
) -> pd.DataFrame:
    """キャッシュから指定 TF の OHLC を取得して UTC インデックスの DataFrame で返す。"""
    stmt = (
        select(Ohlc)
        .where(
            Ohlc.symbol == symbol,
            Ohlc.timeframe == timeframe,
            Ohlc.source == source,
            Ohlc.timestamp >= from_dt,
            Ohlc.timestamp <= to_dt,
        )
        .order_by(Ohlc.timestamp)
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
    df = pd.DataFrame(data).set_index("timestamp")

    # サニティチェック: 返却 timestamp が要求範囲 [from_dt, to_dt] 内に収まっているか。
    # SQL フィルタが効いていれば必ず満たすはずだが、TZ 事故・naive↔aware 混在で違反した時に検知する。
    if len(df) > 0:
        from_aware = from_dt if from_dt.tzinfo else from_dt.replace(tzinfo=timezone.utc)
        to_aware = to_dt if to_dt.tzinfo else to_dt.replace(tzinfo=timezone.utc)
        first_ts = df.index[0]
        last_ts = df.index[-1]
        if first_ts < from_aware or last_ts > to_aware:
            log.error(
                "[cache] returned bars out of range sym=%s tf=%s req=[%s, %s] got=[%s, %s] rows=%d",
                symbol, timeframe, from_aware, to_aware, first_ts, last_ts, len(df),
            )
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    return df


# SQLite のバインド変数制限(古いビルドで 999、新ビルドで 32766)を回避するチャンクサイズ。
_INSERT_CHUNK_SIZE = 500


def store_ohlc(
    session: Session,
    df: pd.DataFrame,
    symbol: str,
    timeframe: str,
    source: str = "mt5",
) -> int:
    """DataFrame を `ohlc` テーブルに upsert する。挿入行数を返す。

    PK 衝突時は OHLC 値と `fetched_at` を更新(リサンプリング結果の上書きにも対応)。
    """
    if df.empty:
        return 0

    now = datetime.now(timezone.utc)
    records = [
        {
            "symbol": symbol,
            "timeframe": timeframe,
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
        stmt = insert(Ohlc).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=["symbol", "timeframe", "timestamp", "source"],
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
    timeframe: str,
    source: str = "mt5",
) -> tuple[datetime, datetime] | None:
    """指定 (symbol, timeframe, source) のキャッシュ最古・最新タイムスタンプを返す。

    `func.min/max + WHERE source=?` だと SQLite が PK 全 prefix を走査するため
    M5 の数百万行で数百 ms かかる。ORDER BY timestamp LIMIT 1 を 2 回実行する
    形に置き換えると、`(symbol, timeframe, timestamp, source)` の PK を使った
    順次走査で先頭/末尾の一致行が即座に取れるため 0ms 級まで短縮される。
    """
    base = select(Ohlc.timestamp).where(
        Ohlc.symbol == symbol,
        Ohlc.timeframe == timeframe,
        Ohlc.source == source,
    )
    oldest_ts = session.execute(base.order_by(Ohlc.timestamp.asc()).limit(1)).scalar()
    if oldest_ts is None:
        return None
    latest_ts = session.execute(base.order_by(Ohlc.timestamp.desc()).limit(1)).scalar()

    oldest = oldest_ts.replace(tzinfo=timezone.utc) if oldest_ts.tzinfo is None else oldest_ts
    latest = latest_ts.replace(tzinfo=timezone.utc) if latest_ts.tzinfo is None else latest_ts
    return oldest, latest
