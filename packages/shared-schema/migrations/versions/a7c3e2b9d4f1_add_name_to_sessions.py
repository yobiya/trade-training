"""add name to sessions for human-readable identification

Revision ID: a7c3e2b9d4f1
Revises: e4b9a1c2d6f8
Create Date: 2026-04-25 12:00:00.000000

仕様書 §17 / §6.1 / §4.2 対応:
  - sessions.name カラム追加(nullable String(100))
  - 一覧画面で銘柄・日付に加えて「手法ニュアンス」を識別するための任意ラベル
  - いつでも編集可、AI 送信対象外(画面識別用)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7c3e2b9d4f1'
down_revision: Union[str, None] = 'e4b9a1c2d6f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('sessions') as batch:
        batch.add_column(sa.Column('name', sa.String(length=100), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('sessions') as batch:
        batch.drop_column('name')
