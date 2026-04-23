"""add symbol to drawings for per-symbol binding

Revision ID: e4b9a1c2d6f8
Revises: d2a5b8c4f9e7
Create Date: 2026-04-23 13:00:00.000000

仕様書 §5.3 / §5.5 / §6.1 統合フロー対応:
  - drawings.symbol カラム追加(nullable String(20) + index)
  - 統合フロー画面で銘柄切替時に該当銘柄の描画だけを表示するため
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e4b9a1c2d6f8'
down_revision: Union[str, None] = 'd2a5b8c4f9e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('drawings') as batch:
        batch.add_column(sa.Column('symbol', sa.String(length=20), nullable=True))
        batch.create_index('ix_drawings_symbol', ['symbol'])
        batch.create_index('ix_drawings_session_id', ['session_id'])


def downgrade() -> None:
    with op.batch_alter_table('drawings') as batch:
        batch.drop_index('ix_drawings_session_id')
        batch.drop_index('ix_drawings_symbol')
        batch.drop_column('symbol')
