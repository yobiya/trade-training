import os
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def create_db_engine(db_path: str | Path = "trading.db") -> Engine:
    # 複数リクエストが並列で DB を書き込むため(例: 銘柄選定画面で 8 銘柄分の
    # OHLC を market-data がキャッシュ INSERT するケース)、SQLite のロック
    # 競合時に待機できるよう connect_args で timeout を指定する。
    engine = create_engine(
        f"sqlite:///{db_path}",
        echo=False,
        connect_args={"timeout": 30.0},
    )

    @event.listens_for(engine, "connect")
    def configure_sqlite(dbapi_conn: object, _: object) -> None:
        cursor = dbapi_conn.cursor()  # type: ignore[union-attr]
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        # busy_timeout: ロック解放待ちのミリ秒。並列 INSERT で "database is locked"
        # を回避する。SQLite は WAL でも書き込みは直列化されるため、短期の
        # 競合は待機して次に譲る運用が安全。
        cursor.execute("PRAGMA busy_timeout=30000")
        # synchronous=NORMAL: WAL と組み合わせで書き込み速度を上げつつ耐障害性も確保
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

    return engine


def _run_migrations(db_path: str | Path) -> None:
    """alembic upgrade head を Python API 経由で実行する。

    起動時に自動適用することで、モデル変更に追従する migration を
    手動実行する必要をなくす(開発体験と本番両方での取りこぼし防止)。
    """
    from alembic import command
    from alembic.config import Config

    # packages/shared-schema/alembic.ini の絶対パスを解決
    cfg_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    if not cfg_path.exists():
        # 配布環境で alembic.ini が同梱されていない場合はスキップ
        # (この場合は呼び出し側が独自にマイグレーションを管理する)
        return
    migrations_dir = cfg_path.parent / "migrations"
    if not migrations_dir.exists():
        return
    config = Config(str(cfg_path))
    # alembic.ini の script_location は相対パスなので、呼び出し側の cwd に依らず
    # 動作するよう絶対パスに書き換える
    config.set_main_option("script_location", str(migrations_dir))
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    command.upgrade(config, "head")


def init_db(db_path: str | Path = "trading.db") -> None:
    """DB を初期化してテーブルを作成する。アプリ起動時に1回呼ぶ。

    alembic upgrade head を自動実行してスキーマを最新にしたあと、
    モデル側で追加されたカラム(未マイグレーション)があれば補完する。
    """
    global _engine, _SessionLocal

    from shared_schema.base import Base
    from shared_schema.models import config, market, trading  # noqa: F401 (model registration)

    _run_migrations(db_path)

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
