"""仕様書 §11 AI 分析の Claude API 接続層。

§11.9 訓練価値保全のためのプロンプト設計方針をシステムプロンプトに展開する:
- 役割定義: 観察者として事実・対応・整合のみ提示
- 禁止: 処方・評価・予測・メモ代弁・結果論観察・判定ラベル再発明
- 推奨: 事実記述・対応関係・差分提示・空欄指摘
- 自問セクション: 処方ではなく省察の起点

API キー未設定 / `ai_mock=True` の場合は固定のモックレポートを返す。
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = """あなたは FX トレード判断の質を磨こうとしているトレーナーに対する **観察者** です。
ユーザー自身が判断を磨くための材料(事実・対応・整合・差分)を提示することが役割で、
処方・評価・予測・代弁は役割の外にあります。

## 厳守する禁止事項(§11.9)

- 処方・評価:「〜すべき」「〜が良い / 悪い」「正解は〜」「間違いは〜」「次は〜」「改善策」「推奨」を一切書かない
- 価格予測:「この後〜方向に動くはず」「〜円まで伸びる可能性」を一切書かない
- メモの代弁:「あなたは〜と考えていた」「本心では〜と感じていたはず」を一切書かない。メモの **事実記述** に留める
- 結果論観察:勝敗が推測できる場合でも、勝敗を踏まえた観察はしない(例:「結果的に負けたのでこの根拠は弱かった」は禁止)
- 判定ラベルの再発明:`機会損失`・`慎重すぎ` 等の結果論ラベルを OHLC から自動生成して断定するのも禁止(値動きの事実のみ記述)
- 想定を超えた断定:「典型的な〜」「一般的には〜」等、観察対象を離れた一般論

## 推奨する表現

- 事実記述:「メモには X と書かれている」「両者の対応は Z」「X は空欄」
- 対応関係:「シナリオ A と実動きは方向が一致しているが到達水準は異なる」
- 差分提示:「想定保有時間 1 時間に対し、実績は 5 時間」
- 空欄・欠落指摘:「代替シナリオが空欄」「相場観の記述が 1 文のみ」

## 出力形式

Markdown で以下の視点別セクションを構成する。該当する観察がない場合は **「特記事項なし」** と明示する。

1. **記入シナリオと判断後の動きの対応** — メモから読み取れるシナリオと判断後の実動きの対応関係を事実として記述
2. **エントリー根拠と判断時点情報の整合** — メモに書かれた根拠が判断時点で実際に成立していたか(時系列に矛盾がないか)
3. **メモの曖昧表現・視点の欠落** — 「なんとなく」等の曖昧語、時間軸を特定しない表現、代替シナリオへの言及無し / 環境認識が単一 TF のみ 等
4. **スタイル選定と実運用のズレ**(決済済みのみ) — 選択スタイルの想定保有時間・想定 RR・典型 SL 幅と実績の差を事実として記述。損益の勝敗には踏み込まない
5. **層 1 非エントリー候補の対比**(あれば、副次) — エントリー銘柄と ★ で候補化した非エントリー銘柄の判断後の値動きを並べて事実として提示。「外すべきでなかった」等の断定はしない

末尾に **「自問すべき問い」** を 3〜5 個添える(処方ではなく、ユーザーが自分で考え直すための起点)。「〜すべきか」「〜した方が良いか」ではなく、
「どう感じていたか」「見ていたか」「どちらが強いと感じたか」の形に統一する。

時刻はメモ本文内では JST 基準。送信データ内の datetime は ISO8601(UTC)。
"""


_MOCK_REPORT = """## 記入シナリオと判断後の動きの対応

(モック応答)送信されたメモには「ブレイク後の押し目」というシナリオが記述されている。
判断時点以降の値動きは entry_price 起点で利方向に動いた事実が記録されている。

## エントリー根拠と判断時点情報の整合

メモに記された根拠と判断時点までの情報の対応関係について、特記事項なし。

## メモの曖昧表現・視点の欠落

横断メモは 1 段落のみで、代替シナリオへの言及はない。

## スタイル選定と実運用のズレ

スタイルの想定 SL 幅と実 SL 幅の差は記録されているが、保有時間が極端に短いため評価対象から外れている。

## 層 1 非エントリー候補の対比

エントリーしなかった候補の事後値動きは送信データに含まれている。

## 自問すべき問い

1. このエントリーで「ブレイク」をどの足で確認していたか?
2. 代替シナリオを書かなかった理由はあるか?
3. 保有時間が短かった判断軸は何だったか?
"""


@dataclass
class AIRunResult:
    report_md: str
    model: str
    input_tokens: int | None
    output_tokens: int | None


def _payload_text(payload: dict[str, Any], has_images: bool) -> str:
    """送信 payload を Claude 向けテキスト部分として整形。"""
    parts: list[str] = []
    parts.append("以下は 1 セッション分のトレード判断データです。")
    parts.append("")
    parts.append("```json")
    parts.append(json.dumps(payload, ensure_ascii=False, indent=2, default=str))
    parts.append("```")
    parts.append("")
    if has_images:
        parts.append(
            "添付画像は判断時刻周辺の各時間足チャートのスクリーンショットです("
            "MVP のため描画オーバーレイ・エントリー/決済マーカーは焼き込まれていません;"
            "描画情報は payload の `drawings`、判断時点の数値は `decision`・`entry_result` を参照してください)。"
        )
    else:
        parts.append("画像は本 MVP では送信されていない前提で、メタデータ・メモ本文のみから観察してください。")
    parts.append("")
    parts.append("上記データに対し、システムプロンプトに従って観察を行い、Markdown レポートを返してください。")
    return "\n".join(parts)


def _data_url_to_image_block(data_url: str) -> dict[str, Any] | None:
    """data URL 形式の文字列を Claude messages の image block に変換。"""
    try:
        header, b64 = data_url.split(",", 1)
    except ValueError:
        return None
    media_type = "image/png"
    if header.startswith("data:") and ";" in header:
        media_type = header[5:].split(";", 1)[0] or "image/png"
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": b64},
    }


def run_analysis(
    payload: dict[str, Any],
    *,
    api_key: str,
    model: str,
    max_tokens: int,
    mock: bool = False,
    images: list[dict[str, str]] | None = None,
) -> AIRunResult:
    """Claude API を呼び出して Markdown レポートを返す。

    `mock=True` または `api_key=""` の場合はモック応答を返す。
    `images` は data URL 形式の各 TF スクリーンショット(MVP は描画なし)。
    """
    images = images or []
    has_images = len(images) > 0

    if mock or not api_key:
        logger.info(
            "AI analysis: mock mode (api_key=%s, mock=%s, images=%d)",
            bool(api_key), mock, len(images),
        )
        return AIRunResult(
            report_md=_MOCK_REPORT,
            model=f"mock:{model}",
            input_tokens=None,
            output_tokens=None,
        )

    try:
        from anthropic import Anthropic
    except ImportError as e:
        logger.error("anthropic SDK not installed: %s", e)
        raise

    client = Anthropic(api_key=api_key)

    content_blocks: list[dict[str, Any]] = []
    for img in images:
        block = _data_url_to_image_block(img.get("data_url", ""))
        if block is None:
            logger.warning("skipping invalid image for tf=%s", img.get("timeframe"))
            continue
        # Claude には timeframe ラベルをテキストで添える(画像内に時間足が分かる視覚情報がない場合の補助)
        content_blocks.append({"type": "text", "text": f"[{img.get('timeframe', '?')} チャート]"})
        content_blocks.append(block)

    content_blocks.append({"type": "text", "text": _payload_text(payload, has_images)})

    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": content_blocks}],
    )

    # Claude SDK の Message.content は list[ContentBlock]
    text_parts: list[str] = []
    for block in response.content:
        text = getattr(block, "text", None)
        if isinstance(text, str):
            text_parts.append(text)
    report_md = "".join(text_parts).strip()

    usage = getattr(response, "usage", None)
    return AIRunResult(
        report_md=report_md,
        model=model,
        input_tokens=getattr(usage, "input_tokens", None) if usage else None,
        output_tokens=getattr(usage, "output_tokens", None) if usage else None,
    )
