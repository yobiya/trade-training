"""仕様書 §11 AI 分析機能の送信データスキーマ。

§11.3 に沿って判断時点メタ・事後結果(R 単位)・経済指標・インジ設定・描画サマリ・メモを
1 つの payload に束ねる。画像(§11.3.1)はフロントで別途書き出すためここには含めない。

送信対象の切り分け:
- 判断時点分析:      meta + memos + indicators + drawings + economic_events(時点以前)
- 振り返り分析:       上記 + entry_result(R 単位 MFE/MAE/r_pnl)+ candidates 事後
- 送らない:          金額損益・勝敗・exit_reason テキスト・機械判定ラベル
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


# --------------------------------------------------------------------------- #
# 個別要素
# --------------------------------------------------------------------------- #

class DecisionMeta(BaseModel):
    """§11.3.2 判断時点のメタ(判断時点分析・振り返り分析 共通)。"""
    decision_type: Literal["entry", "skip"]
    session_mode: str                         # training / real
    symbol: str | None                        # skip(セッション見送り)では null
    decision_time: datetime                   # UTC
    decision_price: float | None              # skip では null
    direction: Literal["buy", "sell"] | None
    sl_price: float | None
    tp_price: float | None
    r_unit_pips: float | None                 # エントリー: 実 SL 幅、skip: なし
    r_unit_source: Literal["trade_sl", "unresolved"]


class EntryResult(BaseModel):
    """§11.3.2 / §9.5 決済済みの事後結果(振り返り分析のみ送る)。"""
    exit_time: datetime
    exit_price: float
    hold_minutes: int                          # 保有時間(分)
    actual_sl_pips: float | None               # 実 SL 幅(pips 補助)
    actual_tp_pips: float | None               # 実 TP 幅(pips 補助)
    mfe_r: float | None
    mae_r: float | None
    mfe_pips: float | None                     # pips 補助
    mae_pips: float | None
    r_pnl: float | None
    # 続き観察 OHLC は別途 §11.3.1 で画像化するため、本 payload では可否だけ示す
    continuation_bars: int
    continuation_available: bool


class StageEvalOut(BaseModel):
    """見送り事後 3 段階(§9.3)。"""
    bars: int
    max_up_pips: float
    max_down_pips: float
    max_up_r: float | None
    max_down_r: float | None


class Layer1Candidate(BaseModel):
    """§11.2 副次情報: ★ で候補化したがエントリーしなかった銘柄。"""
    symbol: str
    memo: str | None
    stages: list[StageEvalOut]
    ref_price: float | None


class IndicatorSnapshot(BaseModel):
    """§11.3.2 / §11.8: インジ設定(値は画像から読み取り)。"""
    kind: str                                  # 'sma' / 'ema' / 'rsi' 等
    period: int | None = None
    source: str | None = None                  # 'close' / 'open' 等
    timeframe: str | None = None


class DrawingSummary(BaseModel):
    """§11.3.2: 描画種別と作成 TF(座標は画像焼き込み済)。"""
    kind: str                                  # 'line' / 'vline' / 'trendline' / 'channel' / 'fibonacci' / 'wave_label' / 'high_break' / 'low_break'
    timeframe: str | None
    symbol: str | None
    label: str | None = None
    note: str | None = None                    # wave_label の番号等


class EconomicEventSummary(BaseModel):
    """§11.3.2 近接経済指標(判断時刻 ±N 時間)。"""
    event_time: datetime                       # UTC
    currency: str
    name: str
    importance: int                            # 1-3
    actual: float | None                       # 発表時刻未到達の指標は null
    forecast: float | None
    previous: float | None
    surprise: float | None                     # actual - forecast


class MemoBlock(BaseModel):
    """§11.3.3 メモ全文。"""
    session_note: str | None                   # 横断メモ(Session.note)
    symbol_memo: str | None                    # エントリー銘柄の銘柄別メモ
    layer1_memos: list[Layer1Candidate] = []   # 層 1 候補のメモ + 事後値動き


# --------------------------------------------------------------------------- #
# 統合 payload
# --------------------------------------------------------------------------- #

class AIAnalysisPayload(BaseModel):
    """§11.3 に基づく AI 送信 payload(画像・プロンプト以外の構造化情報)。

    プレビュー画面でユーザーに表示して送信除外を判断させる基礎。
    画像(§11.3.1)と整合する最小限のテキスト補助。
    """
    analysis_mode: Literal["decision", "review"]   # 判断時点 / 振り返り
    session_id: str
    session_mode: str                              # training / real
    decision: DecisionMeta
    entry_result: EntryResult | None = None        # review 時のみ(§9.5)
    memos: MemoBlock
    indicators: list[IndicatorSnapshot] = []
    drawings: list[DrawingSummary] = []
    economic_events: list[EconomicEventSummary] = []
    layer1_candidates: list[Layer1Candidate] = []

    # 送信時の参照用メタ(ユーザーがプレビューで確認できるもの)
    generated_at: datetime


# --------------------------------------------------------------------------- #
# 実行 / 履歴
# --------------------------------------------------------------------------- #

class ChartImage(BaseModel):
    """§11.3.1 チャート画像。data URL 形式(例: `data:image/png;base64,iVBOR...`)。"""
    timeframe: str
    data_url: str


class AIRunRequest(BaseModel):
    """§11.5 オンデマンド実行リクエスト。

    `analysis_mode` を明示的に指定できる(未指定なら Trade 状態から自動判定)。
    `images` は frontend が lightweight-charts から取った各 TF のスクリーンショット
    (data URL 形式)。MVP では描画オーバーレイ・マーカー焼き込みは含めない。
    """
    analysis_mode: Literal["decision", "review"] | None = None
    images: list[ChartImage] | None = None


class AIHistoryEntry(BaseModel):
    """index.json の 1 エントリ。"""
    id: str                    # ディレクトリ名(例 "20260425T154321_a1b2c3d4e5f6g7h8")
    hash: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_yen: float | None = None
    created_at: datetime


class AIRunResponse(BaseModel):
    """実行直後 / キャッシュヒット時に返すレスポンス。"""
    entry: AIHistoryEntry
    report_md: str
    cached: bool                # 同 hash の既存エントリを返した場合 True
