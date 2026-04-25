"""AI 分析エンドポイント(仕様書 §11)。

提供:
- GET  /sessions/{id}/ai-analysis/preview  送信前 payload プレビュー(§11.6)
- POST /sessions/{id}/ai-analysis/run      実 API 呼び出し or モック実行
- GET  /sessions/{id}/ai-analysis/history  履歴一覧(index.json)
- GET  /sessions/{id}/ai-analysis/report/{entry_id}  レポート Markdown 取得
"""
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from trade_trainer_backend.config import Settings, get_settings
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.ai_analysis import (
    AIAnalysisPayload,
    AIHistoryEntry,
    AIRunRequest,
    AIRunResponse,
)
from trade_trainer_backend.services import ai_client, ai_storage
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
    """§11.6 送信前プレビュー。Claude API には呼び出さない。"""
    return build_ai_analysis_input(session_id, db, analysis_mode=mode)


@router.post(
    "/sessions/{session_id}/ai-analysis/run",
    response_model=AIRunResponse,
)
def run_ai_analysis(
    session_id: str,
    body: AIRunRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AIRunResponse:
    """§11 AI 分析を実行する(オンデマンド)。

    - 同一 payload(hash 一致)の既存エントリがあればキャッシュを返す
    - API キー未設定 / `ai_mock=True` の場合はモック応答で保存
    """
    payload_obj = build_ai_analysis_input(session_id, db, analysis_mode=body.analysis_mode)
    payload = payload_obj.model_dump(mode="json")

    images_dicts: list[dict[str, str]] = []
    if body.images:
        for img in body.images:
            images_dicts.append({"timeframe": img.timeframe, "data_url": img.data_url})

    # キャッシュ判定: 画像の data URL も含める(画像が違えばキャッシュミス)
    payload_hash = ai_storage.compute_payload_hash({**payload, "_images": [
        {"timeframe": i["timeframe"], "data_url_head": i["data_url"][:64]} for i in images_dicts
    ]})

    cached = ai_storage.find_cached_entry(session_id, payload_hash)
    if cached is not None:
        report = ai_storage.read_report(session_id, cached["id"])
        if report is not None:
            return AIRunResponse(
                entry=AIHistoryEntry(**cached),
                report_md=report,
                cached=True,
            )

    result = ai_client.run_analysis(
        payload,
        api_key=settings.anthropic_api_key,
        model=settings.anthropic_model,
        max_tokens=settings.ai_max_tokens,
        mock=settings.ai_mock,
        images=images_dicts,
    )

    entry = ai_storage.save_run(
        session_id,
        payload,
        result.report_md,
        payload_hash=payload_hash,
        model=result.model,
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        cost_yen=None,  # MVP: コスト換算は未実装
        images=images_dicts,
    )

    return AIRunResponse(
        entry=AIHistoryEntry(**entry),
        report_md=result.report_md,
        cached=False,
    )


@router.get(
    "/sessions/{session_id}/ai-analysis/history",
    response_model=list[AIHistoryEntry],
)
def list_ai_history(session_id: str) -> list[AIHistoryEntry]:
    return [AIHistoryEntry(**e) for e in ai_storage.list_history(session_id)]


@router.get(
    "/sessions/{session_id}/ai-analysis/report/{entry_id}",
    response_class=PlainTextResponse,
)
def get_ai_report(session_id: str, entry_id: str) -> str:
    md = ai_storage.read_report(session_id, entry_id)
    if md is None:
        raise HTTPException(status_code=404, detail="Report not found")
    return md
