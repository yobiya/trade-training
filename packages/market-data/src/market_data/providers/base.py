"""データソースプロバイダの抽象インターフェース(仕様書 §2.4)。"""
from abc import ABC, abstractmethod
from datetime import datetime

import pandas as pd


class DataSourceProvider(ABC):
    """全プロバイダが実装すべき共通インターフェース。

    DataFrame の仕様:
    - インデックス: timestamp (UTC aware datetime)
    - カラム: open, high, low, close, volume (float/int)
    - 任意 TF を返す(ver 1.58 で M5 専用前提を撤廃。確定済みバーは TF 別に取得し、
      進行中バーは呼び出し側で「一つ下の TF」を集約する)
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
    def fetch_ohlc(
        self, symbol: str, timeframe: str, from_dt: datetime, to_dt: datetime
    ) -> pd.DataFrame:
        """指定期間の指定 TF の OHLC を取得して返す(ver 1.58 で追加)。

        Args:
            symbol: 銘柄名(接尾辞なし、例: "USDJPY")
            timeframe: 'M5' / 'M15' / 'H1' / 'H4' / 'D1' / 'W1' / 'MN1'
            from_dt: 開始日時(UTC)
            to_dt: 終了日時(UTC)

        Returns:
            UTC インデックスの OHLC DataFrame。データなしなら空 DataFrame。
        """

    def fetch_ohlc_m5(
        self, symbol: str, from_dt: datetime, to_dt: datetime
    ) -> pd.DataFrame:
        """後方互換: M5 の薄いラッパ。新規コードは `fetch_ohlc("M5", ...)` を使う。"""
        return self.fetch_ohlc(symbol, "M5", from_dt, to_dt)

    @abstractmethod
    def fetch_latest_m5(self, symbol: str, n_bars: int) -> pd.DataFrame:
        """直近 n_bars 本の M5 OHLC を取得して返す。リアルトレード用。"""

    @abstractmethod
    def get_available_range(self, symbol: str) -> tuple[datetime, datetime] | None:
        """プロバイダが保持する利用可能な期間を返す。不明なら None。"""

    def get_symbol_digits(self, symbol: str) -> int | None:
        """銘柄の価格表示小数桁数を返す。取得不能なら None。既定実装は None。"""
        return None
