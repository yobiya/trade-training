"""remove_tags_and_rename_candidate_memo

Revision ID: c7a2f1d4e8b3
Revises: 39825c1edbc3
Create Date: 2026-04-21 12:00:00.000000

仕様書 §7.6 タグ不採用方針に伴うスキーマ変更:
  - settings.tags_fixed / tags_custom を削除
  - scenarios.tags を削除
  - session_candidates.eval_tags を削除
  - session_final_decisions.eval_tags を削除
  - session_candidates.add_reason を memo に改名(§6.3.1 候補メモ)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7a2f1d4e8b3'
down_revision: Union[str, None] = '39825c1edbc3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('settings') as batch:
        batch.drop_column('tags_fixed')
        batch.drop_column('tags_custom')
    with op.batch_alter_table('scenarios') as batch:
        batch.drop_column('tags')
    with op.batch_alter_table('session_candidates') as batch:
        batch.drop_column('eval_tags')
        batch.alter_column('add_reason', new_column_name='memo')
    with op.batch_alter_table('session_final_decisions') as batch:
        batch.drop_column('eval_tags')


def downgrade() -> None:
    with op.batch_alter_table('session_final_decisions') as batch:
        batch.add_column(sa.Column('eval_tags', sa.JSON(), nullable=True))
    with op.batch_alter_table('session_candidates') as batch:
        batch.alter_column('memo', new_column_name='add_reason')
        batch.add_column(sa.Column('eval_tags', sa.JSON(), nullable=True))
    with op.batch_alter_table('scenarios') as batch:
        batch.add_column(sa.Column('tags', sa.JSON(), nullable=True))
    with op.batch_alter_table('settings') as batch:
        batch.add_column(sa.Column('tags_custom', sa.JSON(), nullable=False, server_default='[]'))
        batch.add_column(sa.Column('tags_fixed', sa.JSON(), nullable=False, server_default='[]'))
