"""AI 分析エンドポイント(仕様書 §11)。

現状は送信前プレビュー(§11.6)用の payload 生成のみ。
実際の Claude API 呼び出し・レポート保存は Phase 4 で実装する。
"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.ai_analysis import AIAnalysisPayload
from trade_trainer_backend.services.ai_input_builder import build_ai_analysis_input

router = APIRouter(tags=["ai-analysis"])


@router.get(
    "/sessions/{session_id}/ai-analysis/preview",
    response_model=AIAnalysisPayload,
)
def get_ai_analysis_preview(
    session_id: str,
    mode: Annotated[
        Literal["decision", "review"] | None,
        Query(description="analysis_mode を明示指定(未指定なら Trade 状態から自動判定)"),
    ] = None,
    db: Session = Depends(get_db),
) -> AIAnalysisPayload:
    """§11.6 送信前プレビュー用の payload を返す(画像以外)。

    Claude API には呼び出さない。フロントのプレビュー画面で
    ユーザーがメモ段落を除外したり、送信判断に使う。
    """
    return build_ai_analysis_input(session_id, db, analysis_mode=mode)
