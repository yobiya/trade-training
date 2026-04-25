"""drop session-related tables and trading_styles (ver 1.45 file management migration)

Revision ID: b9d7c4a8e2f5
Revises: b9d6f5e1a3c8
Create Date: 2026-04-25 16:00:00.000000

仕様書 §13 / §17 ver 1.45:
  - セッション情報(sessions / session_candidates / session_final_decisions /
    trades / holding_memos / drawings)を data/sessions/{dir}/ にファイル化
  - トレードスタイル(trading_styles)を data/trading-styles/{id}.md にファイル化
  - 上記 7 テーブルを drop する
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b9d7c4a8e2f5'
down_revision: Union[str, None] = 'b9d6f5e1a3c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 削除順序: 子テーブル → 親テーブルの順(FK 制約のため)
_DROP_ORDER = (
    "drawings",
    "holding_memos",
    "trades",
    "session_final_decisions",
    "session_candidates",
    "sessions",
    "trading_styles",
)


def upgrade() -> None:
    for table in _DROP_ORDER:
        op.execute(f"DROP TABLE IF EXISTS {table}")


def downgrade() -> None:
    """downgrade は提供しない(ファイル管理に移行済みで構造復元の意義が薄いため)。"""
    raise NotImplementedError(
        "ver 1.45 のテーブル drop は不可逆。データはファイル管理側にあるため復元不要。"
    )
