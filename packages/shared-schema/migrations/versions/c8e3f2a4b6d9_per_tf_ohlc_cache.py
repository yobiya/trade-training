"""per-timeframe ohlc cache (ver 1.53)

Revision ID: c8e3f2a4b6d9
Revises: b9d7c4a8e2f5
Create Date: 2026-04-25 16:00:00.000000

仕様書 §2.2 / §13 ver 1.53:
  - 上位足(M15 / H1 / H4 / D1 / W1 / MN1)を都度 resample する方式から、
    TF 別にキャッシュして再利用する方式へ切替。
  - 旧 `ohlc_m5` テーブルを drop し、PK が
    (symbol, timeframe, timestamp, source) の `ohlc` テーブルを新規作成。
  - 旧キャッシュは消去されるが provider(MT5 等)から再取得可能のため許容。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8e3f2a4b6d9'
down_revision: Union[str, None] = 'b9d7c4a8e2f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_table('ohlc_m5')
    op.create_table(
        'ohlc',
        sa.Column('symbol', sa.String(20), primary_key=True),
        sa.Column('timeframe', sa.String(8), primary_key=True),
        sa.Column('timestamp', sa.DateTime(), primary_key=True),
        sa.Column('source', sa.String(20), primary_key=True),
        sa.Column('open', sa.Float(), nullable=False),
        sa.Column('high', sa.Float(), nullable=False),
        sa.Column('low', sa.Float(), nullable=False),
        sa.Column('close', sa.Float(), nullable=False),
        sa.Column('volume', sa.BigInteger(), nullable=False),
        sa.Column('fetched_at', sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('ohlc')
    op.create_table(
        'ohlc_m5',
        sa.Column('symbol', sa.String(20), primary_key=True),
        sa.Column('timestamp', sa.DateTime(), primary_key=True),
        sa.Column('source', sa.String(20), primary_key=True),
        sa.Column('open', sa.Float(), nullable=False),
        sa.Column('high', sa.Float(), nullable=False),
        sa.Column('low', sa.Float(), nullable=False),
        sa.Column('close', sa.Float(), nullable=False),
        sa.Column('volume', sa.BigInteger(), nullable=False),
        sa.Column('fetched_at', sa.DateTime(), nullable=False),
    )
