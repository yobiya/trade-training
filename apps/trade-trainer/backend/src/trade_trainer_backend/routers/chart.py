"""チャート取得 / 足送りエンドポイント(chart-stack 単一エンドポイント、設計 §C.3)。"""
import logging
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter

from market_data.accessor import get_ohlc
from market_data.timeframes import TIMEFRAME_MINUTES, resample_ohlc
from trade_trainer_backend.routers._helpers import ensure_session
from trade_trainer_backend.schemas.chart import (
    AdvanceResponse,
    ChartHistoryResponse,
    ChartStackEntry,
    ChartStackResponse,
    OhlcBar,
)
from trade_trainer_backend.services import session_store
from trade_trainer_backend.utils.http import bad_request

log = logging.getLogger(__name__)

router = APIRouter(tags=["chart"])

# 仕様書 §5.1.1 / 設計 §B I-2: 下位 TF から順にフェッチして連鎖集約する
_TF_ORDER = ["M5", "M15", "H1", "H4", "D1", "W1", "MN1"]
_BARS_BY_TF: dict[str, int] = {
    "M5": 200, "M15": 200, "H1": 200, "H4": 200, "D1": 200, "W1": 200, "MN1": 200,
}
# bars × tf_minutes に掛ける単純係数(週末・祝日吸収)。TF 別の細工は不要。
# FX 市場の最大連続クローズ(週末 ~65h + 平日連休余裕)を吸収するため、最下位 TF (M5) で
# 200 × 5 × 10 = 100h を確保する(設計 backend.md §C.2.2)。過去の 1.5 では M5 の 25h 窓が
# 週末に飲まれて 0 bars を返す不具合があった。
_FACTOR = 10

# advance の fetch window 用: FX 市場の最大連続クローズ(週末 ~65h + 平日連休余裕)を吸収する
# 最低保証時間。`bars × 5min × FACTOR` だと小さい bars(例 H1 +1 本 = M5 換算 12 本で 10h)では
# 週末を跨げないため、これに `bars × 5min` を加えて目的バー本数を確実に拾えるようにする。
_ADVANCE_MAX_CLOSURE_HOURS = 100


def _df_to_bars(df: pd.DataFrame) -> list[OhlcBar]:
    """DataFrame を OhlcBar リストに変換する。

    Unix 秒(int)単位でも重複を除去する(broker のサブ秒ズレや内部加工で生じる重複への保険)。
    lightweight-charts は strictly ascending を要求するため。
    """
    bars: list[OhlcBar] = []
    seen_ts: set[int] = set()
    for ts, row in df.iterrows():
        if hasattr(ts, "timestamp"):
            unix_ts = int(ts.timestamp())
        else:
            unix_ts = int(ts)
        if unix_ts in seen_ts:
            continue
        seen_ts.add(unix_ts)
        bars.append(
            OhlcBar(
                t=unix_ts,
                o=float(row["open"]),
                h=float(row["high"]),
                l=float(row["low"]),
                c=float(row["close"]),
                v=int(row["volume"]),
            )
        )
    bars.sort(key=lambda b: b.t)
    return bars


def _bar_start_for_tf(dt: datetime, tf: str) -> datetime:
    """tf の進行中バーの開始時刻を返す(closed='left' label='left' に整合)。"""
    aware = dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    if tf == "MN1":
        return datetime(aware.year, aware.month, 1, tzinfo=timezone.utc)
    if tf == "W1":
        days_since_mon = aware.weekday()
        return aware.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_since_mon)
    if tf == "D1":
        return aware.replace(hour=0, minute=0, second=0, microsecond=0)
    minutes = TIMEFRAME_MINUTES[tf]
    epoch = datetime(1970, 1, 1, tzinfo=timezone.utc)
    delta_min = int((aware - epoch).total_seconds() // 60)
    floored_min = (delta_min // minutes) * minutes
    return epoch + timedelta(minutes=floored_min)


def _aggregate_one_bar(lower_df: pd.DataFrame, dst_tf: str) -> pd.DataFrame:
    """一つ下の TF の DataFrame を dst_tf の集約ルールで 1 行に集約する。"""
    if lower_df.empty:
        return lower_df
    resampled = resample_ohlc(lower_df, dst_tf)
    if resampled.empty:
        return resampled
    return resampled.tail(1)


def _calculate_pips(symbol: str, direction: str, entry: float, exit_price: float) -> float:
    pip_size = 0.01 if symbol.upper().endswith("JPY") else 0.0001
    diff = (exit_price - entry) if direction == "buy" else (entry - exit_price)
    return round(diff / pip_size, 1)


def _check_sl_tp(trade, bars: pd.DataFrame) -> tuple[str, float] | None:  # type: ignore[no-untyped-def]
    for _, bar in bars.iterrows():
        if trade.direction == "buy":
            if trade.sl is not None and bar["low"] <= trade.sl:
                return ("sl", float(trade.sl))
            if trade.tp is not None and bar["high"] >= trade.tp:
                return ("tp", float(trade.tp))
        else:
            if trade.sl is not None and bar["high"] >= trade.sl:
                return ("sl", float(trade.sl))
            if trade.tp is not None and bar["low"] <= trade.tp:
                return ("tp", float(trade.tp))
    return None


def _resolve_symbol(agg, query_symbol: str | None) -> str:
    """銘柄を解決する。保有中は Trade.symbol 優先、分析中はクエリ必須。"""
    if query_symbol:
        return query_symbol.upper()
    if agg.trade is None:
        raise bad_request("symbol query required in analyzing phase")
    return agg.trade.symbol


@router.get("/sessions/{session_id}/chart-stack", response_model=ChartStackResponse)
def chart_stack(session_id: str, symbol: str | None = None) -> ChartStackResponse:
    """全 TF の OHLC を 1 リクエストで返す。

    アルゴリズム:
    1. M5 → MN1 の順に直列で `provider.fetch_ohlc(tf, ...)` を実行
    2. 各 TF の確定済みバーは `bar_start(current_pos, tf)` より前のもの
    3. 上位 TF の最新バー(進行中)は **直前の TF の DataFrame** から `[boundary, current_pos]` 範囲を集約
       → broker の in-progress バー(Friday close 等の未来漏れ)を排除
    4. M5 の最新バーのみ MT5 の値をそのまま使う(最下位なので集約源無し)
    """
    agg = ensure_session(session_id)

    cp = agg.meta.current_position
    current_pos = cp if cp.tzinfo is not None else cp.replace(tzinfo=timezone.utc)
    sym = _resolve_symbol(agg, symbol)

    stacks: list[ChartStackEntry] = []
    prev_tf_df: pd.DataFrame | None = None
    total_start = time.monotonic()

    for tf in _TF_ORDER:
        bars_count = _BARS_BY_TF[tf]
        tf_minutes = TIMEFRAME_MINUTES[tf]
        fetch_minutes = int(bars_count * tf_minutes * _FACTOR)
        from_dt = current_pos - timedelta(minutes=fetch_minutes)
        boundary = _bar_start_for_tf(current_pos, tf)

        tf_start = time.monotonic()
        log.debug("[chart-stack] fetch sym=%s tf=%s from=%s to=%s", sym, tf, from_dt, current_pos)
        try:
            raw = get_ohlc(sym, tf, from_dt, current_pos)
        except Exception as e:  # noqa: BLE001 — HTTP 層境界(I-11.2)
            log.warning("[chart-stack] fetch failed sym=%s tf=%s: %s", sym, tf, e)
            raw = pd.DataFrame()

        # 確定済みバー: boundary より前
        confirmed = raw[raw.index < boundary] if not raw.empty else raw

        # 進行中バー: M5 は raw のまま、上位 TF は前 TF DataFrame から集約
        if tf == "M5":
            live = raw[raw.index >= boundary] if not raw.empty else raw
        elif prev_tf_df is not None and not prev_tf_df.empty:
            live_src = prev_tf_df[prev_tf_df.index >= boundary]
            live = _aggregate_one_bar(live_src, tf)
        else:
            live = pd.DataFrame()

        # 結合 + 末尾 N 本
        if confirmed.empty and live.empty:
            full = pd.DataFrame()
        elif confirmed.empty:
            full = live
        elif live.empty:
            full = confirmed
        else:
            full = pd.concat([confirmed, live])
        if not full.empty:
            # broker が返す重複バーや concat による境界重複を除去 + 昇順ソート。
            # lightweight-charts は strictly ascending を要求する。
            full = full[~full.index.duplicated(keep="last")].sort_index()
            full = full.tail(bars_count)

        bars_list = _df_to_bars(full)
        # §B I-10 observability: TF ごとの所要時間と本数を残す。連続銘柄切替で
        # MT5 IPC が滞留するシナリオの切り分けにも使う(設計 §E.10 / 仕様 §5.1.6)
        log.info(
            "[chart-stack] sym=%s tf=%s elapsed_ms=%d rows=%d",
            sym, tf, int((time.monotonic() - tf_start) * 1000), len(bars_list),
        )
        stacks.append(ChartStackEntry(timeframe=tf, bars=bars_list))
        prev_tf_df = full if not full.empty else None

    log.info(
        "[chart-stack] sym=%s total_elapsed_ms=%d",
        sym, int((time.monotonic() - total_start) * 1000),
    )
    return ChartStackResponse(
        symbol=sym,
        current_position=current_pos,
        stacks=stacks,
    )


@router.get("/sessions/{session_id}/chart-history", response_model=ChartHistoryResponse)
def chart_history(
    session_id: str,
    timeframe: str,
    before: datetime,
    bars: int = 200,
    symbol: str | None = None,
) -> ChartHistoryResponse:
    """指定 TF の `before` より前のバーを N 本取得する(loadMoreHistory 用)。

    chart-stack で取得済みの範囲より過去をユーザーがズームアウト/左パンで見たいときに
    呼び出される。返す bars は厳密に `before` より前のバーのみ(`before` 自身は含まない)。
    """
    if timeframe not in TIMEFRAME_MINUTES:
        raise bad_request(f"Invalid timeframe: {timeframe}")

    agg = ensure_session(session_id)

    sym = _resolve_symbol(agg, symbol)
    before_utc = before.replace(tzinfo=timezone.utc) if before.tzinfo is None else before.astimezone(timezone.utc)

    tf_minutes = TIMEFRAME_MINUTES[timeframe]
    # bars + 余裕を取得し、before より前のバーだけを末尾 N 本返す
    fetch_minutes = int(bars * tf_minutes * _FACTOR)
    from_dt = before_utc - timedelta(minutes=fetch_minutes)

    log.debug("[chart-history] sym=%s tf=%s from=%s before=%s", sym, timeframe, from_dt, before_utc)
    try:
        raw = get_ohlc(sym, timeframe, from_dt, before_utc)
    except Exception as e:  # noqa: BLE001
        log.warning("[chart-history] fetch failed sym=%s tf=%s: %s", sym, timeframe, e)
        raw = pd.DataFrame()

    if raw.empty:
        return ChartHistoryResponse(timeframe=timeframe, bars=[])

    # before より前のバーのみ(排他)
    past = raw[raw.index < before_utc]
    past = past.tail(bars)
    return ChartHistoryResponse(timeframe=timeframe, bars=_df_to_bars(past))


@router.post("/sessions/{session_id}/advance", response_model=AdvanceResponse)
def advance_session(
    session_id: str,
    bars: int = 1,
    symbol: str | None = None,
) -> AdvanceResponse:
    """足を N 本(M5 換算)進める。SL/TP ヒット時は自動決済する。

    仕様 §5.1.1: 「+N 本」は **実在する M5 バーが N 本経過する時刻まで `current_position` を進める**。
    時刻加算ではないため、市場クローズ(週末・祝日)に位置していると自動的に次の取引バーへ
    スキップされる(土曜 H1 +1本 → M5 換算 12 本 → 月曜開場後の M5 12 本目時刻)。

    `new_bars` レスポンスは持たない(frontend は chart-stack を再呼び出しして全 TF を同期取得する)。
    """
    agg = ensure_session(session_id)

    cp = agg.meta.current_position
    current_pos = cp if cp.tzinfo is not None else cp.replace(tzinfo=timezone.utc)

    auto_closed = False
    exit_reason = None
    exit_price = None
    pips_pnl = None

    trade = agg.trade if agg.trade is not None and agg.trade.exit_time is None else None
    advance_symbol = trade.symbol if trade is not None else (symbol.upper() if symbol else None)

    new_pos: datetime
    if advance_symbol:
        # 実 M5 バー N 本を確実に拾える時間幅で取りに行く: 週末・連休クローズ吸収分(_ADVANCE_MAX_CLOSURE_HOURS)
        # に「N 本分の M5 時間」を加える。bars が小さくても週末を跨いで月曜開場後のバーへ到達できる。
        # current_pos の M5 境界(cp_floor)から取得することで:
        #   - m5.index[0] = cp_floor のバー(現在の live bar、もしくは weekend skip 後の最初の取引バー)
        #   - m5.index[bars] = N 本 newly-confirmed したあとの新 live bar の開始時刻 = 新 current_position
        # current_pos + 5min から取得すると weekend skip 時に N 本目を 1 本飛ばしてしまう不具合があった。
        fetch_window = timedelta(hours=_ADVANCE_MAX_CLOSURE_HOURS) + timedelta(minutes=bars * 5)
        cp_floor = _bar_start_for_tf(current_pos, "M5")
        m5 = get_ohlc(
            advance_symbol,
            "M5",
            cp_floor,
            cp_floor + fetch_window,
        )
        if len(m5) > bars:
            # 新 live bar の開始時刻
            target_index = m5.index[bars]
            target_dt = target_index if target_index.tzinfo is not None else target_index.replace(tzinfo=timezone.utc)
            new_pos = target_dt
            # SL/TP 判定対象は newly-confirmed の N 本(index 0 〜 bars-1)
            sl_tp_target = m5.iloc[:bars]
        elif len(m5) >= 1:
            # 取得バー数が bars 以下:取れた最後のバー直後を new_pos とする(連休跨ぎでデータ末尾)
            log.warning(
                "[advance] requested %d M5 bars but only %d available for %s after %s; advancing to last bar end",
                bars, len(m5), advance_symbol, cp_floor,
            )
            last = m5.index[-1]
            last_dt = last if last.tzinfo is not None else last.replace(tzinfo=timezone.utc)
            new_pos = last_dt + timedelta(minutes=5)
            sl_tp_target = m5
        else:
            # 取得 0 本のフォールバック(MT5 切断 / ヒストリ完全外、I-11.6 デフォルト fallback)
            log.warning(
                "[advance] no M5 bars available for %s after %s; falling back to time addition",
                advance_symbol, cp_floor,
            )
            new_pos = current_pos + timedelta(minutes=5 * bars)
            sl_tp_target = m5

        if trade is not None and not sl_tp_target.empty:
            hit = _check_sl_tp(trade, sl_tp_target)
            if hit:
                exit_reason, exit_price = hit
                pips_pnl = _calculate_pips(advance_symbol, trade.direction, trade.entry_price, exit_price)
                trade.exit_time = new_pos
                trade.exit_price = exit_price
                trade.exit_reason = exit_reason
                trade.pips_pnl = pips_pnl
                session_store.save_trade(session_id, trade)
                auto_closed = True
    else:
        # 銘柄未確定(分析中で symbol query 無し)— 現状は到達しない想定だが安全側で時刻加算
        new_pos = current_pos + timedelta(minutes=5 * bars)

    agg.meta.current_position = new_pos
    session_store.save_meta(agg.meta)

    return AdvanceResponse(
        current_position=new_pos,
        trade_auto_closed=auto_closed,
        trade_exit_reason=exit_reason,
        trade_exit_price=exit_price,
        trade_pips_pnl=pips_pnl,
    )
