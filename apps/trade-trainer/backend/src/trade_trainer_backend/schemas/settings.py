"""ユーザー設定スキーマ。仕様書 §17 Setting より、画面で扱う一部を公開。"""
from pydantic import BaseModel


class SettingsResponse(BaseModel):
    """画面から参照する設定の一部(プライバシー・訓練方針に関わる最小限のみ公開)。

    §7.2.3 メモテンプレートはリポジトリ内 Markdown ファイル
    (`data/memo-templates/{candidate,session-note}.md`)で管理するため
    本レスポンスには含まれない(ファイル直接編集 + git 管理)。
    """
    # §5.4 経済指標表示
    event_importance_threshold: int = 3
    event_currencies: list[str] | None = None
    event_shading_before_min: int = 5
    event_shading_after_min: int = 30


class UpdateSettingsRequest(BaseModel):
    event_importance_threshold: int | None = None
    event_currencies: list[str] | None = None
    event_shading_before_min: int | None = None
    event_shading_after_min: int | None = None
