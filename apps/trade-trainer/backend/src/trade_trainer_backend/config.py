"""アプリ設定。環境変数 or .env ファイルから読み込む。"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="TRAINER_", extra="ignore")

    db_path: str = "trading.db"
    app_password: str = "changeme"
    secret_key: str = "change-this-secret-key-to-32plus-chars"
    host: str = "0.0.0.0"
    port: int = 8001
    # 訓練対象の期間設定(現在時刻から見た最小・最大の遡り日数)
    history_min_days: int = 30    # 直近30日は出題しない
    history_max_days: int = 1825  # 最大5年
    # MT5 プロバイダを有効化するか。false の場合はキャッシュ参照モードで起動する
    # (Windows + MetaTrader5 ターミナル起動済みの環境でのみ true にする)
    use_mt5: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
