"""Router 共通 helper(2026-04-29 で抽出)。

設計 §B I-11.2 / §D.1: HTTP 層境界での例外翻訳と検証ヘルパを集約する。
"""
from __future__ import annotations

from trade_trainer_backend.services import session_store
from trade_trainer_backend.services.session_models import SessionAggregate
from trade_trainer_backend.utils.http import not_found


def ensure_session(session_id: str) -> SessionAggregate:
    """セッション取得、無ければ 404。各 router で共通利用される検証 helper。"""
    agg = session_store.load(session_id)
    if agg is None:
        raise not_found("Session not found")
    return agg
