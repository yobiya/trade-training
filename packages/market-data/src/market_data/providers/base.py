"""データソースプロバイダの抽象インターフェース(仕様書 2.4)。"""
from abc import ABC, abstractmethod
from datetime import datetime

import pandas as pd


class DataSourceProvider(ABC):
    """全プロバイダが実装すべき共通インターフェース。

    DataFrame の仕様:
    - インデックス: timestamp (UTC aware datetime)
    - カラム: open, high, low, close, volume (float/int)
    - M5 のみを返す。上位足への変換は timeframes.resample_ohlc で行う。
    """

    SOURCE_NAME: str = ""

    @abstractmethod
    def initialize(self) -> bool:
        """プロバイダを初期化して接続する。成功すれば True。"""

    @abstractmethod
    def shutdown(self) -> None:
        """接続を切断してリソースを解放する。"""

    @abstractmethod
    def is_connected(self) -> bool:
        """現在接続中かどうか。"""

    @abstractmethod
    def fetch_ohlc_m5(
        self, symbol: str, from_dt: datetime, to_dt: datetime
    ) -> pd.DataFrame:
        """指定期間の M5 OHLC を取得して返す。

        Args:
            symbol: 銘柄名(接尾辞なし、例: "USDJPY")
            from_dt: 開始日時(UTC)
            to_dt: 終了日時(UTC)

        Returns:
            UTC インデックスの OHLC DataFrame。データなしなら空 DataFrame。
        """

    @abstractmethod
    def fetch_latest_m5(self, symbol: str, n_bars: int) -> pd.DataFrame:
        """直近 n_bars 本の M5 OHLC を取得して返す。リアルトレード用。"""

    @abstractmethod
    def get_available_range(self, symbol: str) -> tuple[datetime, datetime] | None:
        """プロバイダが保持する利用可能な期間を返す。不明なら None。"""
