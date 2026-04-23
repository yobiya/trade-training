"""ユーザー設定スキーマ。仕様書 §17 Setting より、現在は §7.2.3 メモテンプレート関連のみ公開。"""
from pydantic import BaseModel


class SettingsResponse(BaseModel):
    """画面から参照する設定の一部(プライバシー・訓練方針に関わる最小限のみ公開)。"""
    candidate_memo_template: str | None = None
    session_note_template: str | None = None
    memo_template_enabled: bool = True


class UpdateSettingsRequest(BaseModel):
    candidate_memo_template: str | None = None
    session_note_template: str | None = None
    memo_template_enabled: bool | None = None
