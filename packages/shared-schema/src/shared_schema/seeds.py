"""初期シードデータ。アプリ初回起動時に呼ぶ。

DB シードは Setting のみ。TradingStyle 等のユーザー入力系はファイル管理で扱うため
シードを持たない(§13)。
"""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from shared_schema.models.config import (
    DEFAULT_TIMEFRAME_PRESETS,
    Setting,
    default_spreads,
    default_symbols,
)


def seed_settings(session: Session) -> None:
    """デフォルト設定を挿入。既存なら何もしない。仕様書 §2.8 / §3:
    銘柄リスト・スプレッド初期値は `config/symbols.toml` から導出する。"""
    if session.get(Setting, 1) is not None:
        return

    session.add(
        Setting(
            id=1,
            symbols=default_symbols(),
            spreads=default_spreads(),
            timeframe_presets=DEFAULT_TIMEFRAME_PRESETS,
            time_filter_presets=None,
            event_importance_threshold=3,
            event_currencies=None,
            event_shading_before_min=5,
            event_shading_after_min=30,
            risk_percent=None,
            risk_amount=None,
            updated_at=datetime.now(timezone.utc),
        )
    )


def run_all_seeds(session: Session) -> None:
    """全シードを実行してコミットする。"""
    seed_settings(session)
    session.commit()
