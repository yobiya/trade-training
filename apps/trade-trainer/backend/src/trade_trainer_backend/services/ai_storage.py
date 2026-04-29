"""仕様書 §11.7 AI 分析結果の永続化(ファイルストレージ)。

レイアウト(セッションディレクトリ配下に AI 分析結果も配置):

    data/sessions/{session_dir}/ai_analysis/
        index.json                            # 履歴リスト
        {timestamp}_{short_hash}/
            input.json                        # 送信メタ + メモ本文スナップショット
            report.md                         # AI が返した Markdown レポート
            meta.json                         # hash / tokens / cost / model / created_at
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from trade_trainer_backend.services import session_store
from trade_trainer_backend.utils.json_io import json_default, write_json, write_text

logger = logging.getLogger(__name__)


def _ai_dir(session_id: str) -> Path | None:
    """data/sessions/{dir}/ai_analysis/ を返す。セッションが存在しなければ None。"""
    sdir = session_store.get_dir(session_id)
    if sdir is None:
        return None
    return sdir / "ai_analysis"


def compute_payload_hash(payload: dict[str, Any]) -> str:
    """送信 payload の安定ハッシュを返す(キャッシュ判定用)。

    タイムスタンプ的な揮発フィールド(generated_at)はハッシュ対象から除外し、
    同一データの再送信が同じハッシュになるようにする。画像は payload に含まれない前提(現状 MVP)。
    """
    stable = {k: v for k, v in payload.items() if k != "generated_at"}
    canonical = json.dumps(stable, ensure_ascii=False, sort_keys=True, default=json_default)
    h = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return h[:16]


def _read_index(ai_dir: Path) -> list[dict[str, Any]]:
    p = ai_dir / "index.json"
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("failed to read AI index %s: %s", p, e)
    return []


def find_cached_entry(session_id: str, payload_hash: str) -> dict[str, Any] | None:
    """index.json 内に同 hash のエントリがあれば返す(キャッシュヒット)。"""
    ai_dir = _ai_dir(session_id)
    if ai_dir is None or not ai_dir.exists():
        return None
    for entry in _read_index(ai_dir):
        if entry.get("hash") == payload_hash:
            return entry
    return None


def list_history(session_id: str) -> list[dict[str, Any]]:
    """セッションの AI 分析履歴(index.json の全エントリ)。最新順で返す。"""
    ai_dir = _ai_dir(session_id)
    if ai_dir is None or not ai_dir.exists():
        return []
    entries = _read_index(ai_dir)
    entries.sort(key=lambda e: e.get("created_at", ""), reverse=True)
    return entries


def read_report(session_id: str, entry_id: str) -> str | None:
    """指定エントリの report.md を返す。無ければ None。"""
    ai_dir = _ai_dir(session_id)
    if ai_dir is None:
        return None
    target = ai_dir / entry_id / "report.md"
    if not target.exists():
        return None
    try:
        return target.read_text(encoding="utf-8")
    except OSError:
        return None


def _decode_data_url(data_url: str) -> bytes | None:
    """`data:image/png;base64,iVBOR...` 形式の文字列を bytes にデコード。"""
    import base64
    try:
        header, b64 = data_url.split(",", 1)
    except ValueError:
        return None
    if "base64" not in header:
        return None
    try:
        return base64.b64decode(b64)
    except (ValueError, TypeError):
        return None


def save_run(
    session_id: str,
    payload: dict[str, Any],
    report_md: str,
    *,
    payload_hash: str,
    model: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cost_yen: float | None = None,
    images: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """1 回の AI 分析実行結果を保存し、index.json に追記する。返り値はインデックスエントリ。

    `images` を渡すと {entry_dir}/images/{timeframe}.png として保存する。
    """
    ai_dir = _ai_dir(session_id)
    if ai_dir is None:
        raise FileNotFoundError(f"session not found: {session_id}")

    now = datetime.now(timezone.utc)
    timestamp_part = now.strftime("%Y%m%dT%H%M%S")
    entry_id = f"{timestamp_part}_{payload_hash}"

    entry_dir = ai_dir / entry_id
    entry_dir.mkdir(parents=True, exist_ok=True)

    write_json(entry_dir / "input.json", payload)
    write_text(entry_dir / "report.md", report_md)

    if images:
        img_dir = entry_dir / "images"
        img_dir.mkdir(parents=True, exist_ok=True)
        for img in images:
            tf = img.get("timeframe")
            data_url = img.get("data_url")
            if not tf or not data_url:
                continue
            blob = _decode_data_url(data_url)
            if blob is None:
                logger.warning("invalid image data_url for tf=%s", tf)
                continue
            (img_dir / f"{tf}.png").write_bytes(blob)

    meta = {
        "id": entry_id,
        "hash": payload_hash,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_yen": cost_yen,
        "created_at": now,
    }
    write_json(entry_dir / "meta.json", meta)

    # index.json 更新(同一 hash があれば置き換え、無ければ追記)
    entries = _read_index(ai_dir)
    entries = [e for e in entries if e.get("id") != entry_id]
    entries.append({
        "id": entry_id,
        "hash": payload_hash,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_yen": cost_yen,
        "created_at": now,
    })
    write_json(ai_dir / "index.json", entries)

    return entries[-1]
