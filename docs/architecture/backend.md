# backend 設計

← [設計トップ](../ARCHITECTURE.md) | [横断不変条件](./invariants.md) | [frontend overview](./frontend-overview.md)

---

`apps/trade-trainer/backend/` の FastAPI アプリと、`packages/market-data/` の OHLC 取得層をまとめて扱う。frontend は backend 経由でのみ market-data に触れる(直接呼ばない)。

## 目次

- [§A レイヤ構成](#a-レイヤ構成)
- [§B セッションファイル構造](#b-セッションファイル構造)
- [§C market-data 層](#c-market-data-層)
- [§D 主要エンドポイントのフロー](#d-主要エンドポイントのフロー)
- [§E 認証 / DB マイグレーション / ログ](#e-認証--db-マイグレーション--ログ)
- [§F 既知の落とし穴](#f-既知の落とし穴)

---

## §A レイヤ構成

```
apps/trade-trainer/backend/src/trade_trainer_backend/
├─ main.py                    ← create_app() / lifespan
├─ routers/                   ← HTTP ハンドラのみ。例外 → HTTP コード変換 + service ディスパッチ
│  ├─ auth.py                 ← パスワード認証(Starlette session)
│  ├─ sessions.py             ← セッション CRUD / メモ / 振り返り
│  ├─ chart.py                ← GET chart-stack / POST advance / GET chart-history
│  ├─ trades.py               ← エントリー / 決済 / 取得
│  ├─ drawings.py             ← 描画 CRUD
│  ├─ events.py               ← 経済指標取得
│  ├─ settings.py             ← アプリ設定
│  ├─ ai_analysis.py          ← AI 分析 run / history / report
│  └─ _helpers.py             ← session 検証 helper など共通
├─ services/                  ← ドメインロジック。HTTP に依存しない
│  ├─ session_store/          ← セッションファイル I/O(パッケージ分割済)
│  │  ├─ __init__.py          ←   公開 API(load / save_* / create_session / rename_dir / delete_*)
│  │  ├─ io.py                ←   低レベル I/O(read/write_session_json / dir 操作 / Conflicted-copy 検知)
│  │  └─ serialize.py         ←   dataclass ↔ dict 変換(_meta_to_dict / _aggregate_to_dict / from_dict)
│  ├─ session_models.py       ← dataclass(SessionMeta / Trade / Candidate / FinalDecision / Drawing 等)
│  ├─ candidates.py           ← 候補追加削除
│  ├─ post_eval.py            ← 事後評価(MFE / MAE / R-pnl / 3 段階観察)
│  ├─ ai_input_builder.py     ← AI 送信 payload 構築
│  ├─ ai_client.py            ← Anthropic SDK ラッパ + モック
│  ├─ ai_storage.py           ← AI 履歴(index.json + report.md)+ payload hash キャッシュ
│  └─ memo_templates.py       ← data/memo-templates の起動時ロード
├─ utils/                     ← 共通 utility(state-less)
│  ├─ json_io.py              ← json_default(datetime/Decimal) / read_json / write_json
│  ├─ datetime.py             ← ensure_aware_utc(dt) ほか tz 補助
│  └─ http.py                 ← HTTPException ファクトリ(not_found / bad_request)
├─ schemas/                   ← Pydantic レスポンス・リクエスト型
├─ auth.py                    ← パスワード照合
├─ config.py                  ← Settings(env) + Depends で注入
└─ deps.py                    ← DB session の Depends

packages/market-data/src/market_data/
├─ accessor.py                ← 公開エントリ。session オープン + fetcher 呼び出し
├─ fetcher.py                 ← TF 別キャッシュ戦略(M5 取得 + 上位足 resample)
├─ cache.py                   ← SQLAlchemy 経由の SELECT / UPSERT、サニティチェック
├─ timeframes.py              ← TIMEFRAME_MINUTES 表 + resample_ohlc(M5 → 上位足)
└─ providers/
   ├─ base.py                 ← DataSourceProvider 抽象クラス
   └─ mt5.py                  ← MetaTrader5 Python API 実装(Windows 専用)

packages/shared-schema/src/shared_schema/
├─ models/market.py           ← OHLC / 経済指標 SQLAlchemy モデル
├─ models/config.py           ← Settings モデル
└─ migrations/                ← Alembic
```

### A.1 責務原則

- **router は ifelse / 例外 → HTTP の翻訳 + service 呼び出しに留める**(20-30 行/ハンドラ程度)
- **service は HTTP の Request / Response を知らない**(将来 CLI 化する場合の見通し)
- **session_store は他 service から呼ばれる窓口**。ファイル I/O はここに閉じる
- **utils は state-less な共通 helper のみ置く**。ドメイン知識を持たない(知識を持つコードは services へ)
- **market-data は backend service の概念(セッション等)を知らない**。`get_ohlc(symbol, tf, from_dt, to_dt)` レベルの純粋取得に徹する

### A.2 起動シーケンス

```
uvicorn → main.create_app() → FastAPI(lifespan=lifespan)

lifespan:
  1. init_db(db_path)               # SQLAlchemy エンジン初期化
  2. run_all_seeds(session)         # Settings 等のシード
  3. load_memo_templates()          # data/memo-templates → in-memory
  4. configure(db_path, MT5Provider if use_mt5 else None)
       └ MT5Provider().initialize()  # mt5.initialize()
  5. yield  ← 受付開始
  6. shutdown / mt5.shutdown
```

`TRAINER_USE_MT5=false` 起動時は MT5 を使わない(キャッシュ参照モード)。
`TRAINER_AI_MOCK=true` 起動時は AI 分析がモック応答を返す。

---

## §B セッションファイル構造

`data/sessions/{dir}/` の典型レイアウト([§17 データモデル](../spec/17-data-model.md) 参照):

```
20231018-2120-USDJPY-doubletop/      # ディレクトリ名は可読ラベル(rename される)
├─ session.json                       # meta + trade + final_decision + drawings + holding_memos を統合
├─ note.md                            # 横断メモ(§7.2.2、settled_at トリガー)
├─ candidates/
│  ├─ USDJPY.md                       # 銘柄別メモ(§7.2.1)
│  └─ EURJPY.md
└─ ai_analysis/
   ├─ index.json                      # 履歴 entry のメタ(hash, model, tokens, ts)
   └─ {entry_id}.md                   # レポート Markdown
```

`session.json` の構造:

```json
{
  "id": "20231018-2120-27b4",         // 不変識別子(YYYYMMDD-HHMM-xxxx)
  "name": null,
  "started_at": "...",
  "presented_at": "...",
  "current_position": "...",
  "mode": "training",
  "settled_at": null,
  "indicator_config_id": null,
  "trade": { ... } | null,             // エントリー時のみ
  "final_decision": { "has_entry": ..., "skip_reason": ... } | null,
  "drawings": [ ... ],                 // 描画オブジェクト配列
  "holding_memos": [ { "timestamp": "...", "memo": "..." } ]
}
```

ディレクトリ名は識別に使わない(rename される)。`note.md` と `candidates/*.md` は自由記述・1 ファイル 1 テキストで分割を維持(エディタ編集の利便性のため)。

### B.1 旧分割形式との後方互換

過去には `trade.json` / `final_decision.json` / `drawings.json` / `holding_memos.jsonl` を個別ファイルに保存していた時期があり、その形式のまま残っているセッションディレクトリを読み出せるよう、**読み出し時にフォールバック** を持つ。session.json に対応フィールドがなく、かつ旧ファイルが存在する場合だけ旧ファイルを読む。次回の save 時に統合形式で書き戻され、旧ファイルは削除される(自然移行)。

### B.2 session_store の公開 API

`services/session_store/` パッケージの公開 API は `__init__.py` から re-export(consumer は `from trade_trainer_backend.services import session_store` のまま不変):

| 関数 | 用途 |
|---|---|
| `load(session_id) -> SessionAggregate \| None` | session.json + note.md + candidates/*.md を読み込み、SessionAggregate に組み立てる(旧形式フォールバックを含む) |
| `create_session(meta) -> SessionAggregate` | 新規セッション作成(ディレクトリ + session.json) |
| `save_meta(meta)` | session.json の meta 部分を更新(他フィールド保持) |
| `save_note(session_id, note)` | note.md 更新 |
| `save_candidate(session_id, symbol, memo)` | candidates/{symbol}.md 更新 |
| `save_trade(session_id, trade)` | session.json 内の `trade` フィールドを更新 |
| `save_final_decision(session_id, fd)` | session.json 内の `final_decision` フィールドを更新 |
| `save_drawings(session_id, drawings)` | session.json 内の `drawings` フィールドを更新 |
| `rename_dir(session_id)` | meta + 候補状態に応じてディレクトリ rename |
| `append_holding_memo(session_id, memo)` | session.json 内の `holding_memos` 配列に追加(全体を書き直し) |
| `delete_*` | 各種削除(候補等) |

書き込みは `Path.write_text` の単純書き込み([invariants.md I-4](./invariants.md#i-4-ファイル書き込みは単純書き込み))。`SessionAggregate` は `meta + note + candidates + trade + final_decision + drawings + holding_memos` の集約 dataclass。

---

## §C market-data 層

`packages/market-data/` の OHLC 取得・キャッシュ・プロバイダ抽象。

### C.1 公開 API

`market_data.accessor`(モジュール上の関数のみ。クラス化しない方針):

| 関数 | 用途 | 備考 |
|---|---|---|
| `configure(db_path, provider=None)` | アプリ起動時に 1 回 | provider=None ならキャッシュ参照のみ |
| `get_ohlc(symbol, timeframe, from_dt, to_dt) -> DataFrame` | 通常の OHLC 取得 | UTC-aware index |
| `get_latest(symbol, timeframe, n_bars)` | リアルタイム用(trade-live で使用) | provider 接続必須 |
| `get_symbol_digits(symbol) -> int` | 価格表示桁数 | provider 不在時はヒューリスティック |
| `shutdown()` | アプリ終了時 | provider を切断 |

backend の `routers/chart.py` 等は `from market_data.accessor import get_ohlc` のみで利用する。

### C.2 取得フロー

`backend.routers.chart.chart_stack` が全 TF を直列に取得する。キャッシュなし([invariants.md I-2](./invariants.md#i-2-チャート取得は単一-chart-stack-エンドポイントで直列フェッチ--最新バーは下位-tf-集約) 参照)。

```python
TF_ORDER = ["M5", "M15", "H1", "H4", "D1", "W1", "MN1"]
BARS_BY_TF = {tf: 200 for tf in TF_ORDER}
FACTOR = 1.5

prev_tf_df = None
stacks = []

for tf in TF_ORDER:
    bars_count = BARS_BY_TF[tf]
    fetch_minutes = int(bars_count * TIMEFRAME_MINUTES[tf] * FACTOR)
    from_dt = current_position - timedelta(minutes=fetch_minutes)
    boundary = bar_start(current_position, tf)

    raw = provider.fetch_ohlc(symbol, tf, from_dt, current_position)
    confirmed = raw[raw.index < boundary]

    if tf == "M5":
        live = raw[raw.index >= boundary]
    elif prev_tf_df is not None:
        slice_for_live = prev_tf_df[prev_tf_df.index >= boundary]
        live = _aggregate_one_bar(slice_for_live, tf)
    else:
        live = empty_df

    full = concat([confirmed, live]).tail(bars_count)
    stacks.append({"timeframe": tf, "bars": df_to_bars(full)})
    prev_tf_df = full

return ChartStackResponse(symbol, current_position, stacks)
```

#### C.2.1 設計の要点

- **直列フェッチ**: MT5 Python API は同一銘柄に対して並列リクエストをシリアライズする特性があるため、frontend で 7 並列にしても効果なし。backend で順次に処理する方が制御しやすく、ユーザーには下位 TF から表示が現れる UX
- **下位 TF 連鎖集約**: 上位 TF の最新バーは前段で確定したフル DataFrame(confirmed + live)から `[boundary, current_position]` 範囲を `resample_ohlc` で 1 行に集約する。これにより `current_position` 以降の broker データが混入しない(未来漏れ防止)
- **broker の in-progress バーは捨てる**: `raw[raw.index < boundary]` で boundary より前の確定済みのみ採用
- **キャッシュなし**: `ohlc` テーブルは本フローからは読み書きしない(将来再導入候補)。MT5 ターミナル側キャッシュで 2 回目以降は十分速い
- **`FACTOR = 1.5`**: bars × tf_minutes に掛ける単純係数(週末・祝日吸収のため)。TF 別に分岐させない

#### C.2.2 末尾の安全策

- 各 `provider.fetch_ohlc` は失敗時 `log.warning` で記録し、空 DataFrame を返す([invariants.md I-10](./invariants.md#i-10-observability-の最低ライン))
- 1 つの TF が失敗しても、その TF だけ空 bars で返し、他の TF は継続(I-11.1 / I-11.3)

### C.3 プロバイダ抽象

#### C.3.1 `DataSourceProvider`(`providers/base.py`)

```python
class DataSourceProvider(ABC):
    SOURCE_NAME: str
    initialize() -> bool
    shutdown()
    is_connected() -> bool
    fetch_ohlc(symbol, timeframe, from_dt, to_dt) -> DataFrame   # 任意 TF
    fetch_ohlc_m5(symbol, from_dt, to_dt) -> DataFrame           # 内部で fetch_ohlc("M5") に委譲する M5 専用ショートカット
    fetch_latest_m5(symbol, n_bars) -> DataFrame
    get_available_range(symbol) -> (dt, dt) | None
    get_symbol_digits(symbol) -> int | None
```

DataFrame の規約:
- index: `timestamp` (UTC tz-aware)
- columns: `open, high, low, close, volume`
- 任意 TF を返す。ライブバー(進行中バー)は呼び出し側で「一つ下の TF」から集約する

#### C.3.2 `MT5Provider`(`providers/mt5.py`)

- Windows 専用(`if sys.platform != 'win32': raise ImportError`)
- `mt5.copy_rates_range()` を呼ぶ
- 銘柄名解決: 接尾辞付き(例 `USDJPY.a`)を `_resolve_symbol` でキャッシュ付き解決
- **マーケットウォッチ自動追加**: `_resolve_symbol` 内で `mt5.symbol_select(resolved, True)` を呼ぶ。MT5 は MarketWatch に追加されていない銘柄に対して `copy_rates_range` が silent に空配列を返すため、明示的に MarketWatch へ追加する。symbol_select が失敗した場合は `log.warning` で検知できるようにする
- **datetime は必ず tz-aware UTC で渡す**([invariants.md I-1.2](./invariants.md#i-12-mt5-プロバイダ境界))
- 戻り値の Unix タイムスタンプを `pd.to_datetime(unit='s', utc=True)` で UTC-aware に
- サニティチェック: 戻り値 range が要求 range の ±2h 以内か log warn
- 銘柄解決失敗(`symbols_get` でも見つからない)時は `log.warning` で検知できるようにする(broker 側に該当銘柄が無い徴候)

新プロバイダ(Dukascopy 等)を追加する場合は `DataSourceProvider` を実装する。

### C.4 resample 規約(ライブバー集約用)

`timeframes.resample_ohlc(df, dst_tf)` は **任意 src TF の DataFrame** を `dst_tf` の集約ルールで再サンプルする。src 非依存(M5 限定の前提を持たない)とすることで、主用途である **進行中バーを「一つ下の TF」から計算** すること([I-2](./invariants.md#i-2-チャート取得は単一-chart-stack-エンドポイントで直列フェッチ--最新バーは下位-tf-集約))に使えるようにする。

- `closed='left', label='left'`(バーは開始時刻ラベル、対応窓は `[start, start+tf_delta)`)
- 集約: `open=first, high=max, low=min, close=last, volume=sum`
- 出力もすべて UTC-aware index

`MN1` のリサンプル規則は `MS`(Month Start)。月毎に集約され、入力 DataFrame に含まれる各月のバーが 1 本に集約される。

`TIER_BELOW: dict[str, str]` がライブバー計算チェーンを定義する: `M15→M5 / H1→M15 / H4→H1 / D1→H4 / W1→D1 / MN1→W1`。

---

## §D 主要エンドポイントのフロー

### D.1 GET `/sessions/{id}/chart-stack` (`routers/chart.py:chart_stack`)

```
1. session_store.load(id)         # 404 if not found
2. to_dt = current_position
3. for tf in TF_ORDER (直列):
     fetch_minutes = bars * tf_minutes * 1.5
     from_dt = to_dt - timedelta(minutes=fetch_minutes)
     raw = provider.fetch_ohlc(symbol, tf, from_dt, to_dt)
     confirmed = raw[index < bar_start(to_dt, tf)]
     if tf == 'M5':
       live = raw[index >= boundary]
     else:
       live = aggregate_one_bar(prev_tf_df[index >= boundary], tf)
     full = (confirmed + live).tail(bars)
     prev_tf_df = full
4. return ChartStackResponse(symbol, current_position, stacks=[{tf, bars}, ...])
```

### D.2 POST `/sessions/{id}/advance` (`routers/chart.py:advance_session`)

`bars` パラメータは **M5 換算本数**(frontend が entry TF → M5 比率を掛けて算出する。仕様 §5.1.1)。

```
1. session_store.load(id)
2. new_pos = current_pos + 5min × bars
3. trade = active trade (if any)
4. advance_symbol = trade.symbol or query param symbol
5. if advance_symbol:
     new_m5 = market_data.get_ohlc(advance_symbol, 'M5', current_pos+5min, new_pos)
     if trade and not new_m5.empty:
       hit = _check_sl_tp(trade, new_m5)  # 各 M5 バーで high>=tp, low<=sl 判定
       if hit:
         update trade.exit_*
         session_store.save_trade(...)
6. agg.meta.current_position = new_pos
   session_store.save_meta(...)
7. return AdvanceResponse(new_bars, current_position, trade_auto_closed, ...)
```

frontend は `new_bars` で M5 を即時マージ + 各上位 TF を `bars=2` で末尾再取得(詳細は [`frontend-overview.md` § handleAdvance](./frontend-overview.md#handleadvance))。

### D.3 POST `/sessions/{id}/skip` (`routers/sessions.py:skip_session`)

```
1. ensure session exists
2. fd = FinalDecision(has_entry=False, skip_reason=body.reason)
3. session_store.save_final_decision + rename_dir
4. _maybe_settle(session_id)  # 横断メモ非空なら settled_at セット
5. return SessionResponse
```

### D.4 POST `/sessions/{id}/trade/enter` (`routers/trades.py:enter_trade`)

```
1. ensure session, no active trade
2. _upsert_candidate_on_entry: 銘柄別メモを初期挿入(なければ)
3. trade = Trade(direction, sl, tp, entry_price=current_price, ...)
4. session_store.save_trade
5. fd = FinalDecision(has_entry=True)
6. session_store.save_final_decision + rename_dir
7. return TradeResponse
```

### D.5 GET `/sessions/{id}/post-review` (`routers/sessions.py:get_post_review`)

```
1. session_store.load
2. for c in candidates if c.symbol != trade.symbol:
     rv = post_eval.evaluate_symbol(c.symbol, presented_at, r_unit_pips=None)  # pips のみ
3. if trade:
     trade_r_unit = post_eval.resolve_trade_r_unit_pips(trade)  # SL ベース
     rv = post_eval.evaluate_symbol(trade.symbol, presented_at, trade_r_unit)
     obs = post_eval.evaluate_entry(trade)  # MFE/MAE/r_pnl
     entry_review = EntryReview(stages, mfe_r, mae_r, r_pnl, ...)
4. elif final_decision.has_entry == False and skip_reason:
     skip_review = SkipReview(reason, stages=[])
5. return PostReviewResponse(candidates, skip, entry)
```

`considered_styles` / 見送り代理 R は採用しない。見送り・候補振り返りは SL 未確定で R 換算が信頼できないため pips のみで評価する。

### D.6 POST `/sessions/{id}/ai-analysis/run` (`routers/ai_analysis.py:run_ai_analysis`)

```
1. payload = ai_input_builder.build_ai_analysis_input(session_id, db, mode)
2. payload_hash = ai_storage.compute_payload_hash(payload + image data_url 先頭 64B)
3. cached = ai_storage.find_cached_entry(session_id, payload_hash)
   if cached: return cached
4. result = ai_client.run_analysis(payload, api_key, model, max_tokens, mock, images)
5. entry = ai_storage.save_run(session_id, payload, result.report_md, ...)
6. return AIRunResponse(entry, report_md, cached=False)
```

`build_ai_analysis_input` の入力スキーマ:
- DecisionMeta(エントリー or 見送り判断時のメタ)
- EntryResult(振り返り時のみ、MFE / MAE / r_pnl / continuation_available)
- MemoBlock(横断メモ + 銘柄別メモ + 層 1 候補メモ)
- IndicatorSnapshot(§11.8、現状未実装)
- DrawingSummary(描画種別 + TF)
- EconomicEventSummary(判断時刻 ±N 時間)
- Layer1Candidate(★ 付き非エントリー銘柄)
- generated_at

[invariants.md I-9](./invariants.md#i-9-ai-分析の送信ガードレール) で送らないものを定義。

---

## §E 認証 / DB マイグレーション / ログ

### E.1 認証

`auth.py` の依存性注入(`Depends(verify_session)`)を全 router に適用(auth router を除く)。Starlette `SessionMiddleware` で password 照合済セッション ID を cookie に保持。

`TRAINER_APP_PASSWORD` env で変更可能。

### E.2 起動時の DB マイグレーション

`init_db(db_path)` は `Base.metadata.create_all` を呼ぶ。既存 DB は **Alembic マイグレーション** で進める:

```
cd packages/shared-schema && uv run alembic upgrade head
```

新規スキーマ変更時は Alembic マイグレーションファイルを `migrations/versions/` に追加し、`down_revision` を最新 head に紐付ける。

### E.3 ログ設定

uvicorn 標準のロガーに従う:
- `logger = logging.getLogger(__name__)` で各モジュールに logger を作る
- `--log-level info` 起動で stdout に出る(本番は journald / file 経由を想定)
- 観測性ガイドラインは [invariants.md I-10](./invariants.md#i-10-observability-の最低ライン)

### E.4 設定(env)

| 変数 | 用途 |
|---|---|
| `TRAINER_USE_MT5` | `false` で MT5 無効(キャッシュ参照のみ) |
| `TRAINER_AI_MOCK` | AI 関連、market-data には影響なし |
| `TRAINER_APP_PASSWORD` | 認証パスワード |
| `db_path` | 既定 `apps/trade-trainer/backend/trading.db`(env で上書き可) |

---

## §F 既知の落とし穴

### F.1 backend / API 層

| 事象 | 原因 | 対処 |
|---|---|---|
| advance しても new_bars=0 | 進めた range の M5 がキャッシュにない & MT5 が応答しない | MT5 接続確認 / ブローカーのヒストリカル範囲を確認 |
| post-review で空応答 | 候補がない or trade も skip も未確定 | 仕様通り(対象なしを示す) |
| AI 分析が遅い | 同 payload キャッシュ未ヒット + max_tokens 大 | `TRAINER_AI_MOCK=true` でテスト時バイパス |
| セッションファイル破損 | 書き込み中の中断 or 外部編集 | `session_store.load` が `None` を返す → 404 |

### F.2 market-data 層

| 事象 | 原因 | 対処 |
|---|---|---|
| 「TF ごとに価格が違って見える」 | 上位 TF cache が古い M5 状態で resample されたまま | `tf_extremes[1] <= to_dt` の右リフレッシュで自動収束 |
| 「足進めても M5 だけ動く」 | 上位 TF cache の右拡張が `last_bar_end > to_dt - tf_delta` に縛られていた(旧仕様) | 修正済(`tf_extremes[1] <= to_dt`) |
| 「MT5 から空が返り続けて遅い」 | session current_position が available data の範囲外 | broker 接続とブローカーのヒストリカル範囲を確認。各 fetch は数百 ms で完結するため致命的ではない |
| 「ブローカー時刻 ≠ UTC で価格がズレる」 | naive datetime を MT5 に渡していた(過去事故) | tz-aware で渡す(現状)。`mt5.fetch_ohlc_m5` の sanity warn でも検知 |
