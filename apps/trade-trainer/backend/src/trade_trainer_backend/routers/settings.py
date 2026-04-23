"""ユーザー設定エンドポイント(§7.2.3 メモテンプレート等)。"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from shared_schema.models.config import Setting
from trade_trainer_backend.deps import get_db
from trade_trainer_backend.schemas.settings import SettingsResponse, UpdateSettingsRequest

router = APIRouter(prefix="/settings", tags=["settings"])


def _response(st: Setting) -> SettingsResponse:
    return SettingsResponse(
        candidate_memo_template=st.candidate_memo_template,
        session_note_template=st.session_note_template,
        memo_template_enabled=st.memo_template_enabled,
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
