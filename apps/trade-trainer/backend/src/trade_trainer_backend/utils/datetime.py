"""tz-aware UTC 変換 utility(I-1 不変条件)。"""
from datetime import datetime, timezone


def ensure_aware_utc(dt: datetime) -> datetime:
    """naive datetime を UTC として補完して aware にする。aware ならそのまま返す。

    本コードベースは UTC 統一が前提(設計 §B I-1)。naive 値は内部的には UTC として扱うため、
    出力境界(JSON / API / DB write)で aware を保証する場合に本関数を使う。
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def parse_iso_datetime(s: str | None) -> datetime | None:
    """ISO 8601 文字列を tz-aware datetime にパースする(末尾 Z は +00:00 として扱う)。"""
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None
