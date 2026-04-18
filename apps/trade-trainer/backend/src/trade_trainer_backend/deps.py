"""FastAPI 共通依存(DB セッション、認証チェック)。"""
from collections.abc import Generator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from trade_trainer_backend.auth import require_auth


def get_db(
    _: None = Depends(require_auth),
) -> Generator[Session, None, None]:
    """認証済みリクエストに DB セッションを注入する。"""
    from shared_schema.database import get_session
    yield from get_session()
