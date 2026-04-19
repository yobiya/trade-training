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
    _auto_add_missing_columns(_engine)


def _auto_add_missing_columns(engine: Engine) -> None:
    """モデルとテーブルのカラムを比較し、不足分を ALTER TABLE ADD COLUMN で追加する。

    alembic 導入前の暫定措置。SQLite は ADD COLUMN で既存行に NULL が入る
    ため nullable カラムのみ安全に追加できる。非 NULL カラムが増えた場合は
    手動マイグレーションが必要。
    """
    from shared_schema.base import Base

    with engine.connect() as conn:
        for table_name, table in Base.metadata.tables.items():
            existing = {
                row[1] for row in conn.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
            }
            for col in table.columns:
                if col.name not in existing:
                    if not col.nullable and col.default is None and col.server_default is None:
                        # 既存行に値が決められない非 NULL カラムはスキップ(人手介入が必要)
                        continue
                    col_type = col.type.compile(dialect=engine.dialect)
                    nullable_clause = "" if col.nullable else " NOT NULL"
                    conn.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {col.name} {col_type}{nullable_clause}"
                    )
        conn.commit()


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
