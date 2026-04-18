from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def create_db_engine(db_path: str | Path = "trading.db") -> Engine:
    engine = create_engine(f"sqlite:///{db_path}", echo=False)

    @event.listens_for(engine, "connect")
    def configure_sqlite(dbapi_conn: object, _: object) -> None:
        cursor = dbapi_conn.cursor()  # type: ignore[union-attr]
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    return engine


def init_db(db_path: str | Path = "trading.db") -> None:
    """DB を初期化してテーブルを作成する。アプリ起動時に1回呼ぶ。"""
    global _engine, _SessionLocal

    from shared_schema.base import Base
    from shared_schema.models import config, market, trading  # noqa: F401 (model registration)

    _engine = create_db_engine(db_path)
    _SessionLocal = sessionmaker(bind=_engine, expire_on_commit=False)
    Base.metadata.create_all(_engine)


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("DB not initialized — call init_db() first")
    return _engine


def get_session() -> Generator[Session, None, None]:
    """FastAPI の Depends で使う DI 用ジェネレータ。"""
    if _SessionLocal is None:
        raise RuntimeError("DB not initialized — call init_db() first")
    with _SessionLocal() as session:
        yield session
