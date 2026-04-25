"""drop memo template columns from settings

Revision ID: b9d6f5e1a3c8
Revises: a7c3e2b9d4f1
Create Date: 2026-04-25 14:00:00.000000

仕様書 §7.2.3 / §13 ver 1.44:
  - メモテンプレートを DB → リポジトリ内 Markdown ファイル管理に移行
  - settings テーブルから 3 カラムを drop
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b9d6f5e1a3c8'
down_revision: Union[str, None] = 'a7c3e2b9d4f1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('settings') as batch:
        batch.drop_column('memo_template_enabled')
        batch.drop_column('session_note_template')
        batch.drop_column('candidate_memo_template')


def downgrade() -> None:
    with op.batch_alter_table('settings') as batch:
        batch.add_column(sa.Column('candidate_memo_template', sa.Text(), nullable=True))
        batch.add_column(sa.Column('session_note_template', sa.Text(), nullable=True))
        batch.add_column(sa.Column('memo_template_enabled', sa.Boolean(), server_default=sa.text('1'), nullable=False))
