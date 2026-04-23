"""memo_restructure: drop scenarios / trade.style_selection_reason / add sessions.note / add settings memo templates

Revision ID: d2a5b8c4f9e7
Revises: c7a2f1d4e8b3
Create Date: 2026-04-23 12:00:00.000000

仕様書 §7 メモ機能再構成:
  - scenarios テーブル廃止(横断メモ Session.note と銘柄別メモ SessionCandidate.memo に統合)
  - trades.style_selection_reason 削除(横断メモへ)
  - sessions.note TEXT 追加(§7.2.2 横断メモ)
  - settings に candidate_memo_template / session_note_template / memo_template_enabled 追加(§7.2.3)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd2a5b8c4f9e7'
down_revision: Union[str, None] = 'c7a2f1d4e8b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # scenarios テーブル廃止
    op.drop_table('scenarios')

    # trades.style_selection_reason 削除
    with op.batch_alter_table('trades') as batch:
        batch.drop_column('style_selection_reason')

    # sessions.note 追加(横断メモ、§7.2.2)
    with op.batch_alter_table('sessions') as batch:
        batch.add_column(sa.Column('note', sa.Text(), nullable=True))

    # settings にメモテンプレート関連追加(§7.2.3)
    with op.batch_alter_table('settings') as batch:
        batch.add_column(sa.Column('candidate_memo_template', sa.Text(), nullable=True))
        batch.add_column(sa.Column('session_note_template', sa.Text(), nullable=True))
        batch.add_column(sa.Column('memo_template_enabled', sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    with op.batch_alter_table('settings') as batch:
        batch.drop_column('memo_template_enabled')
        batch.drop_column('session_note_template')
        batch.drop_column('candidate_memo_template')

    with op.batch_alter_table('sessions') as batch:
        batch.drop_column('note')

    with op.batch_alter_table('trades') as batch:
        batch.add_column(sa.Column('style_selection_reason', sa.Text(), nullable=True))

    op.create_table(
        'scenarios',
        sa.Column('trade_id', sa.String(length=36), nullable=False),
        sa.Column('environment', sa.Text(), nullable=True),
        sa.Column('market_view', sa.Text(), nullable=True),
        sa.Column('symbol_reason', sa.Text(), nullable=True),
        sa.Column('skipped_candidates', sa.Text(), nullable=True),
        sa.Column('event_recognition', sa.Text(), nullable=True),
        sa.Column('wave_count', sa.Text(), nullable=True),
        sa.Column('scenario_main', sa.Text(), nullable=True),
        sa.Column('scenario_alt1', sa.Text(), nullable=True),
        sa.Column('scenario_alt2', sa.Text(), nullable=True),
        sa.Column('entry_basis', sa.Text(), nullable=True),
        sa.Column('exit_memo', sa.Text(), nullable=True),
        sa.Column('reflection', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['trade_id'], ['trades.id']),
        sa.PrimaryKeyConstraint('trade_id'),
    )
