"""初期シードデータ。アプリ初回起動時に呼ぶ。"""
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from shared_schema.models.config import (
    DEFAULT_CANDIDATE_MEMO_TEMPLATE,
    DEFAULT_SESSION_NOTE_TEMPLATE,
    DEFAULT_SPREADS,
    DEFAULT_SYMBOLS,
    DEFAULT_TIMEFRAME_PRESETS,
    Setting,
)
from shared_schema.models.trading import TradingStyle


def seed_trading_styles(session: Session) -> None:
    """トレードスタイルのプリセットを挿入(仕様書 8.3)。既存なら何もしない。"""
    if session.get(TradingStyle, "short") is not None:
        return

    presets = [
        TradingStyle(
            id="short",
            name="短期トレード",
            primary_timeframe="M5",
            expected_hold_time="10分〜1時間",
            expected_rr="1:1.5",
            typical_sl_pips="10〜20",
            description="M5 基準の短期トレード。スキャルピングに近い判断が必要。",
        ),
        TradingStyle(
            id="mid",
            name="中期トレード",
            primary_timeframe="H1",
            expected_hold_time="数時間〜1日",
            expected_rr="1:2",
            typical_sl_pips="30〜50",
            description="H1 基準の中期トレード。押し目・戻りを丁寧に待つ。",
        ),
        TradingStyle(
            id="news",
            name="指標トレード",
            primary_timeframe="M5",
            expected_hold_time="数分〜30分",
            expected_rr="1:1.5",
            typical_sl_pips="10〜30",
            description="強指標発表前後を狙う特殊戦略。方向感の強い局面限定。",
        ),
        TradingStyle(
            id="swing",
            name="スイング",
            primary_timeframe="H4",
            expected_hold_time="数日",
            expected_rr="1:3",
            typical_sl_pips="50〜100",
            description="H4/D1 基準の数日保有トレード。大きなトレンドに乗る。",
        ),
    ]
    session.add_all(presets)


def seed_settings(session: Session) -> None:
    """デフォルト設定を挿入。既存なら何もしない。"""
    if session.get(Setting, 1) is not None:
        return

    session.add(
        Setting(
            id=1,
            symbols=DEFAULT_SYMBOLS,
            spreads=DEFAULT_SPREADS,
            timeframe_presets=DEFAULT_TIMEFRAME_PRESETS,
            time_filter_presets=None,
            event_importance_threshold=3,
            event_currencies=None,
            event_shading_before_min=5,
            event_shading_after_min=30,
            risk_percent=None,
            risk_amount=None,
            candidate_memo_template=DEFAULT_CANDIDATE_MEMO_TEMPLATE,
            session_note_template=DEFAULT_SESSION_NOTE_TEMPLATE,
            memo_template_enabled=True,
            updated_at=datetime.now(timezone.utc),
        )
    )


def run_all_seeds(session: Session) -> None:
    """全シードを実行してコミットする。"""
    seed_trading_styles(session)
    seed_settings(session)
    session.commit()
