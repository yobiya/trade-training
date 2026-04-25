"""トレードスタイル参照エンドポイント(仕様書 §8、ver 1.45 でファイル管理化)。

CRUD は提供しない。スタイル定義は `data/trading-styles/{id}.md` を
テキストエディタで直接編集し、変更は git でコミットする(個人運用)。
編集反映にはバックエンド再起動が必要。
"""
from fastapi import APIRouter

from trade_trainer_backend.schemas.trading_style import TradingStyleResponse
from trade_trainer_backend.services.trading_style_store import (
    TradingStyle as StoreStyle,
    list_styles,
)

router = APIRouter(prefix="/trading-styles", tags=["trading-styles"])


def _to_response(s: StoreStyle) -> TradingStyleResponse:
    return TradingStyleResponse(
        id=s.id,
        name=s.name,
        primary_timeframe=s.primary_timeframe,
        expected_hold_time=s.expected_hold_time,
        expected_rr=s.expected_rr,
        typical_sl_pips=s.typical_sl_pips,
        description=s.description,
        is_active=s.is_active,
    )


@router.get("", response_model=list[TradingStyleResponse])
def list_styles_endpoint(include_inactive: bool = False) -> list[TradingStyleResponse]:
    return [_to_response(s) for s in list_styles(include_inactive=include_inactive)]
