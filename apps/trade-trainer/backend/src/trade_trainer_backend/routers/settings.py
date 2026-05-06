"""ユーザー設定エンドポイント(§7.2.3 メモテンプレート等)。"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from shared_schema.models.config import Setting
from shared_schema.symbols_config import get_symbols_config
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.settings import (
    SettingsResponse,
    SymbolsListResponse,
    UpdateSettingsRequest,
)

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/symbols", response_model=SymbolsListResponse)
def get_symbols_endpoint() -> SymbolsListResponse:
    """§2.8 銘柄一覧を返す。`config/symbols.toml` の `default_active = true` を宣言順で返す。

    frontend は起動時に 1 回取得して銘柄ドロップダウン等に使う(SYMBOLS ハードコード廃止)。
    """
    cfg = get_symbols_config()
    return SymbolsListResponse(symbols=cfg.default_active_codes())


def _response(st: Setting) -> SettingsResponse:
    return SettingsResponse(
        event_importance_threshold=st.event_importance_threshold,
        event_currencies=st.event_currencies,
        event_shading_before_min=st.event_shading_before_min,
        event_shading_after_min=st.event_shading_after_min,
    )


@router.get("", response_model=SettingsResponse)
def get_settings_endpoint(db: Session = Depends(get_db)) -> SettingsResponse:
    st = db.get(Setting, 1)
    if st is None:
        raise HTTPException(status_code=500, detail="Settings not initialized")
    return _response(st)


@router.patch("", response_model=SettingsResponse)
def update_settings_endpoint(
    body: UpdateSettingsRequest,
    db: Session = Depends(get_db),
) -> SettingsResponse:
    """§7.2.3 メモテンプレート等の更新。未指定フィールドは変更しない。"""
    st = db.get(Setting, 1)
    if st is None:
        raise HTTPException(status_code=500, detail="Settings not initialized")
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(st, key, value)
    st.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return _response(st)
