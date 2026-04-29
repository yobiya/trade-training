"""トレード関連テーブル。

セッション情報(TradeSession / SessionCandidate / SessionFinalDecision /
Trade / HoldingMemo / Drawing)はファイル管理(`data/sessions/{dir}/`)で扱うため、
本モジュールには SQLAlchemy モデルを定義しない(§13 / §17)。

ファイル管理側のドメインモデルは
`apps/trade-trainer/backend/src/trade_trainer_backend/services/session_models.py` を参照。
"""

# 旧 SQLAlchemy モデル群は migration b9d7c4a8e2f5_drop_session_and_style_tables.py で drop 済
