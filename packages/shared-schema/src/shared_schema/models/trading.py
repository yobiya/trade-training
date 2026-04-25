"""トレード関連テーブル。

ver 1.45 でセッション情報(TradeSession / SessionCandidate / SessionFinalDecision /
Trade / HoldingMemo / Drawing)とトレードスタイル(TradingStyle)を
ファイル管理に移行したため、本モジュールには SQLAlchemy モデルを定義しない。

ファイル管理側のドメインモデルは
`apps/trade-trainer/backend/src/trade_trainer_backend/services/session_models.py` を参照。
"""

# 旧 SQLAlchemy モデル群はすべて削除(migration b9d7c4a8e2f5_drop_session_and_style_tables.py)
