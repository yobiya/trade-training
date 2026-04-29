# 設計ドキュメント

← [仕様書](./spec/README.md) | [作業手順](./WORKFLOW.md) | 関連: [drawing-tools.md](./architecture/drawing-tools.md)

---

ここには **コードがどう構成されているか・なぜそう作ってあるか** を記録する。仕様書(`docs/spec/`)が「何を実現したいか」を書くのに対し、本ドキュメントは「どう実現しているか」「守るべき不変条件」を書く。

[`WORKFLOW.md`](./WORKFLOW.md) のとおり、設計に影響する変更を行う前に該当セクションを更新し、変更後にも整合させる。

## 利用ルール

- 仕様変更タスク([WORKFLOW §A](./WORKFLOW.md))で **設計に影響がある場合**、関連セクションを先に更新してからコードを書く
- バグ修正タスク([WORKFLOW §B](./WORKFLOW.md))で **設計上の不変条件違反が原因だった場合**、修正前に該当セクションを更新する
- 設計トピックが大きく増えた時のみ、本ファイルを章 → 別ファイルに分離する(現状は 1 ファイルで十分)

## 設計ドキュメントが守るべきこと

- **責務 / 状態の所有 / インターフェース / 主要フロー / 不変条件** を含める
- コードを書き写さない(コードに変更があるとすぐ陳腐化する)。**契約と判断基準** を書く
- ファイル参照は `path:line` 形式(行番号は移動するのでセクション参照を併用)

## 目次

- [§A. システム全体図](#a-システム全体図) — リポジトリ構成 / 責務分担 / 主要データフロー / データ所有 / 起動シーケンス
- [§B. 横断的な不変条件](#b-横断的な不変条件)(I-1〜I-11) — **変更前に必ず確認**
- [§C. market-data 設計](#c-market-data-設計) — TF 別キャッシュ / provider 抽象 / resample
- [§D. backend 設計](#d-backend-設計) — router / service 構成 / セッションファイル / エンドポイントフロー
- [§E. frontend 設計](#e-frontend-設計) — コンポーネント / SessionPage 状態 / hooks 契約 / フェーズ導出
- [drawing-tools.md](./architecture/drawing-tools.md)(別ファイル) — 描画モード状態機械

---

# §A. システム全体図

## A.1 リポジトリ構成

```
trade-training/
├─ apps/
│  └─ trade-trainer/          ← 訓練アプリ(本番第一弾)
│     ├─ backend/             ← FastAPI(Python)
│     └─ frontend/            ← React + Vite + lightweight-charts
├─ packages/                  ← 複数アプリで共有するライブラリ
│  ├─ market-data/            ← OHLC 取得 / TF 別キャッシュ / Provider 抽象
│  └─ shared-schema/          ← SQLAlchemy モデル + Alembic マイグレーション
├─ data/
│  ├─ sessions/               ← ユーザー入力(セッション情報)
│  ├─ memo-templates/         ← メモ初期テンプレ
│  └─ trading.db (SQLite)     ← 機械生成キャッシュ + Settings(対象外: data/sessions/)
└─ docs/
   ├─ spec/                   ← 仕様書(何を作るか)
   ├─ ARCHITECTURE.md         ← 設計ドキュメント(本ファイル)
   ├─ architecture/
   │  └─ drawing-tools.md     ← 描画モード状態機械(別途切り出し)
   └─ WORKFLOW.md             ← 作業手順(必読)
```

## A.2 責務分担

| 層 | 責務 | 主要モジュール |
|---|---|---|
| **frontend** | UI / ユーザー操作の受付 / クロスヘア同期 / チャート描画 | `pages/SessionPage`, `components/Chart`, `hooks/useCharts` |
| **backend (router)** | HTTP エンドポイント / リクエスト→service ディスパッチ / 例外ハンドリング | `routers/*.py` |
| **backend (service)** | ドメインロジック / セッション永続化 / 事後評価 / AI 入力構築 | `services/*.py` |
| **market-data** | OHLC のキャッシュ + プロバイダ抽象 / TF 集約 | `accessor`, `fetcher`, `cache`, `providers/mt5` |
| **shared-schema** | DB スキーマ(SQLAlchemy)+ マイグレーション | `models/market.py`, `models/config.py` |

「frontend は market-data を直接呼ばない」「backend service は HTTP の知識を持たない」「market-data は backend service の概念(セッション等)を知らない」を厳守。

## A.3 主要データフロー(俯瞰)

### A.3.1 チャート表示(GET /sessions/{id}/chart-stack)

```
ブラウザ
   │  GET /api/sessions/{id}/chart-stack?symbol=USDJPY
   ▼
[backend:routers/chart.py:chart_stack]
   │  for tf in [M5, M15, H1, H4, D1, W1, MN1]:        # 直列ループ
   │      raw = provider.fetch_ohlc(symbol, tf, from, current_pos)
   │      confirmed = raw[index < bar_start(current_pos, tf)]
   │      live = (M5 ? raw[index >= boundary]
   │             : aggregate_one_bar(prev_tf_df[index >= boundary], tf))
   │      stacks.append({tf, confirmed + live})
   │      prev_tf_df = stacks[-1]                        # 次 TF の集約源
   ▼
[backend] → ChartStackResponse(symbol, current_position, stacks=[{tf, bars}, ...])
```

キャッシュ層なし。MT5 ターミナル側のキャッシュにより 2 回目以降は高速。

### A.3.2 足進め(POST /sessions/{id}/advance)

```
ブラウザ(handleAdvance(n))
   │  m5_bars = n × tfRatioToM5(entryTf)   # M5=1 / M15=3 / H1=12 / ...
   │  POST /api/sessions/{id}/advance?bars=<m5_bars>&symbol=USDJPY
   ▼
[backend:routers/chart.py:advance_session]
   │  new_pos = current_pos + 5min × bars  (backend は常に M5 換算で受ける)
   │  保有中なら _check_sl_tp で auto-close 判定(M5 単位ループ)
   │  session_store.save_meta + (任意で)save_trade
   │  返却: AdvanceResponse(new_bars, current_position, trade_auto_closed, ...)
   ▼
ブラウザ
   │  mergeM5Bars(res.new_bars)  ← 楽観的反映、追加 round-trip 不要
   │  refreshTails({ M5: m5_bars+2, M15: 2, ..., MN1: 2 })  ← 各 TF 末尾を並列再取得
   │  api.sessions.get → setSession(current_position 反映)
```

「+1 本」= entry TF の 1 バー(仕様 §5.1.1)。frontend が entryTf → M5 比率を掛けて `bars` を計算する。backend のシグネチャは「`bars` = M5 換算本数」のまま不変。

### A.3.3 振り返り(GET /sessions/{id}/post-review)

```
[backend:routers/sessions.py:get_post_review]
   │  agg = session_store.load
   │  for c in candidates: evaluate_symbol(presented_at, r_unit_pips=None) ← pips のみ
   │  if trade: evaluate_entry(trade) ← Trade.sl ベースの R 表示維持
   │  返却: PostReviewResponse(candidates[], skip, entry)
```

### A.3.4 AI 分析(POST /sessions/{id}/ai-analysis/run)

```
[backend:routers/ai_analysis.py:run_ai_analysis]
   │  payload = ai_input_builder.build_ai_analysis_input(session_id, db)
   │  payload_hash = compute(payload + image_data_url 先頭 64B)
   │  if cached(hash): return 既存レポート
   │  else: ai_client.run_analysis(payload, images, model, max_tokens, mock?)
   │        ai_storage.save_run(payload_hash, report_md, tokens, ...)
   │  返却: AIRunResponse(entry, report_md, cached)
```

## A.4 データの所有

| データ | ストア | 同期対象 | 詳細 |
|---|---|---|---|
| セッション情報(セッション・候補・Trade・見送り・描画・保有メモ) | `data/sessions/{dir}/` | ✓(Dropbox 等) | [§D.2 セッションファイル構造](#d2-セッションファイル構造) |
| メモテンプレート | `data/memo-templates/*.md` | ✓(git) | リポジトリ内、起動時 1 回ロード |
| OHLC キャッシュ(TF 別) | SQLite `ohlc` | ✗(再取得可能) | [§C](#c-market-data-設計) |
| 経済指標 | SQLite `economic_events` | ✗(再取得可能) | market-data CLI が日次で取得 |
| アプリ設定 | SQLite `settings` | ✗ | 単一行 |
| AI 分析結果 | `data/sessions/{dir}/ai_analysis/` | ✓(同期推奨) | セッションと同経路 |

## A.5 アプリ起動シーケンス(backend)

```
uvicorn → main.create_app() → FastAPI(lifespan=lifespan)

lifespan:
  1. init_db(db_path)               # SQLAlchemy エンジン初期化
  2. run_all_seeds(session)         # Settings 等のシード
  3. load_memo_templates()          # data/memo-templates → in-memory
  4. configure(db_path, MT5Provider if use_mt5 else None)
       │  MT5Provider().initialize()  # mt5.initialize()
  5. yield  ← 受付開始
  6. shutdown / mt5.shutdown
```

`TRAINER_USE_MT5=false` 起動時は MT5 を使わない(キャッシュ参照モード)。
`TRAINER_AI_MOCK=true` 起動時は AI 分析がモック応答を返す。

## A.6 画面遷移(frontend)

```
LoginPage
   │ password 入力
   ▼
SessionListPage
   │ 既存セッション一覧 / 新規作成
   ▼
SessionPage(統合フロー、§6.1)
   │  phase = 'analyzing' | 'holding' | 'reviewing' を session 状態から導出
   │  すべて 1 画面内で処理(画面遷移なし)
```

詳細は [§E.3 SessionPage のフェーズ導出](#e3-sessionpage-のフェーズ導出) を参照。

---

# §B. 横断的な不変条件

ここに書かれた不変条件は **コード全体で共通に守られるべき前提**。これらが破れるとバグが連鎖する(過去事故あり)。新規コード・修正コード を書く前に、関連する条件を確認すること。

## I-1. タイムスタンプは UTC で統一する

「naive datetime をブローカー時刻として解釈される」事故が過去に起きた([§I-1.4](#i-14-過去事故) 参照)。

### I-1.1 UTC 規律

- **アプリ全体で datetime はすべて UTC として扱う**(JST 表示は frontend 側で formatJST 経由のみ)
- **DB(SQLite)内は naive で保存する** が、その naive 値の中身は **UTC**(timezone データを持たない単純な事情)
- **読み出し時**: naive → `replace(tzinfo=timezone.utc)` で aware にしてから返す(`packages/market-data/src/market_data/cache.py` の `get_cached_ohlc`)
- **書き込み時**: aware → `replace(tzinfo=None)` で naive にして INSERT(同モジュールの `store_ohlc`)
- **API 境界(JSON)**: ISO 8601 + `Z` サフィックスで返す
- **Python 関数引数**: なるべく aware を要求する。naive を許容する関数は内部で UTC に補完する

### I-1.2 MT5 プロバイダ境界

- `MT5Provider.fetch_ohlc_m5(from_dt, to_dt)` には **必ず tz-aware UTC datetime** を渡す
- naive datetime を渡すと MT5 はそれを **ブローカーサーバー時刻**(JST 等)として解釈し、9 時間ズレた範囲を返す
- 該当コード: `packages/market-data/src/market_data/providers/mt5.py:fetch_ohlc_m5`(naive で来たら UTC 補完するガードあり)
- 戻り値の Unix タイムスタンプは実 UTC

### I-1.3 サニティチェック(Phase A 整備)

- `cache.get_cached_ohlc`: 返却 timestamp が要求 `[from_dt, to_dt]` 内にあることを assert(違反時は `log.error` + 空返却)
- `mt5.fetch_ohlc_m5`: 戻り値の最初/最後が要求 range の ±2h 以内であることを判定(違反時は `log.warning`)

### I-1.4 過去事故

- ブローカー切替時、新ブローカーが JST サーバー時刻を使用 → naive datetime が JST として解釈され、cache に「07:00 UTC」と書き込まれた値が実際には「JST 07:00 = UTC 22:00 prev day」だった
- 修正: `mt5.py` で aware UTC datetime を渡すよう変更

## I-2. チャート取得は単一 chart-stack エンドポイントで直列フェッチ + 最新バーは下位 TF 集約

(ver 1.59 で改訂。旧 I-2「TF 別個別取得 + 再帰集約 + キャッシュ」は MT5 のシリアライズ特性で cold load 20 秒以上かかる問題を解消できず白紙再構築)

- **キャッシュなし**: `ohlc` テーブルは本フローからは読み書きしない(残置)。毎回 MT5 から直接取得
- **単一エンドポイント `GET /sessions/{id}/chart-stack`**: 全 TF の OHLC を 1 リクエストで返す
- **直列フェッチ・下位 TF から順**: M5 → M15 → H1 → H4 → D1 → W1 → MN1。前 TF が完了してから次へ。MT5 Python API のシリアライズ特性に整合し、ユーザーは下位 TF から順に表示が現れる
- **各 TF の最新バーは「一つ下の TF」を集約して算出**:
  - M5: MT5 が返す値をそのまま(最下位なので集約源無し)
  - M15: 直前の M5 fetch 結果から `[bar_start(current_pos, M15), current_pos]` 範囲を集約 → 1 本
  - H1: 直前の M15 結果(集約済み最新バー含む)から同様に集約
  - … 以下連鎖
- **未来漏れ防止**: broker が返す in-progress バー(週中に問い合わせると Friday close が含まれる等)は捨てる。代わりに下位 TF を集約源にすることで `current_position` 以降のデータが混入しない
- **過去確定済みバー**は broker のネイティブ集約値を信頼(`bar_start(current_pos, tf)` より前のバー)

詳細は [§C](#c-market-data-設計)。

## I-3. ファイル管理 vs SQLite

ver 1.45 / 1.53 で確立した役割分担:

| 種別 | 場所 | 同期(Dropbox) |
|---|---|---|
| ユーザー入力(セッション情報・メモ・描画) | `data/sessions/{dir}/` ファイル群 | **対象** |
| ユーザー入力(メモテンプレート) | `data/memo-templates/*.md` | git |
| 機械生成キャッシュ(OHLC・経済指標) | SQLite `trading.db` | 対象外(消耗品) |
| アプリ設定 | SQLite `settings` | 対象外 |

「セッション情報を SQLite に書く」「OHLC をファイルに書く」を **やらない**。混ざるとバックアップ戦略が破綻する。

詳細は [`docs/spec/13-data-storage.md`](./spec/13-data-storage.md)。

## I-4. ファイル書き込みは単純書き込み(ver 1.54 で atomic 撤去)

個人用シングルプロセス + Dropbox 同期前提では、tmp + os.replace の atomic 書き込みは過剰だったため撤去。`Path.write_text` / `json.dumps + write_text` で十分。

ファイル破損リスクを下げる手順:
- 書き込み中のクラッシュは個人運用では実用上稀
- 同期競合は Dropbox 側で `Conflicted copy` ファイルが生成される(`session_store._is_conflict_name` でスキャン除外)

新規にファイル書き込みを追加する場合も同様のシンプル方式を踏襲する。

## I-5. セッションの「進行中」/「決着済み」状態モデル

- `SessionMeta.settled_at`: `None` = 進行中、ISO 値あり = 決着済み
- 自動遷移条件(§4.2.2): **トレード決済済 or 見送り確定済 + 横断メモ非空** で自動的に `settled_at` セット
- 逆遷移なし。決着済みでもメモ・描画の編集は継続可

`is_settled` フラグを別カラムで持たない(`settled_at != None` で導出)。

## I-6. `current_position` の単一情報源

- 真の値: `session.json` の `current_position`(UTC ISO 文字列)
- frontend の `session.current_position` は **読み取り専用キャッシュ**(advance 後は backend から取得し直す)
- frontend の `barsByTf` の最新バー時刻は表示用であり、これを「現在時刻」と見做さない
- backend のすべての TF 取得は `to_dt = current_position` を起点にする

## I-7. バー時系列の単調性

- Provider / cache / frontend いずれも バー配列は **時刻昇順** であること
- `useCharts.mergeBarsTail` は incoming 配列が strictly ascending か検証(違反時 console.warn)
- 結合後もソートして返す(古い値が末尾に紛れる事故を防止)

## I-8. 上位 TF の「ライブバー」扱い

- 現在進行中の M5 が含まれる上位 TF バーは **未確定**(close が今後変わる)
- `fetcher.fetch_ohlc` の右端 refresh で毎回再 resample してキャッシュを上書き
- SL/TP 自動判定で「未確定バーの high/low」を当てに行かないこと(リスク: 後続 M5 で高値が更新されて事後的に hit と判定される)
  - 現状は M5 単位で `_check_sl_tp` するため OK だが、将来上位足ベースの判定を追加する際の注意

## I-9. AI 分析の送信ガードレール

- §11.9 のとおり、結果論バイアスを避けるため以下は **送らない**:
  - 損益(金額)・勝敗フラグ・決済理由テキスト・機械判定ラベル
- AI 入力スキーマ(`schemas/ai_analysis.py`)から該当フィールドが除かれていること
- ユーザーがメモに「結果論」を書いた場合の扱いは:
  - 仕様: メモには AI に送ってよい内容のみを書く前提([§11.3.3](./spec/11-ai-analysis.md#1133-メモ全文))
  - 実装ガード: backend では追加処理しない(プロンプト規範に委ねる、ver 1.49)

## I-10. observability の最低ライン

[Phase A 観測性整備] により、以下を満たす:

- `chart.py` の chart fetch 試行と結果(rows/失敗)が `log.debug` / `log.warning` で記録される
- `cache.get_cached_ohlc` 範囲外データを `log.error` する
- `mt5.fetch_ohlc_m5` 呼び出しが `log.debug`(件数記録)、TZ 異常を `log.warning` する
- frontend `useCharts.refreshTails` / `fetchOne` の失敗が `console.warn` で残る

新たに失敗が沈黙するパスを追加しない(I-11.1 で具体化)。本項はログ要件の最低限を扱い、ユーザー通知や「空 vs 失敗」の区別は次の I-11 が規定する。

## I-11. エラー処理 / 失敗の可視化

過去事故(MT5 マーケットウォッチ未追加銘柄で `copy_rates_range` が silent に空配列を返し、UI が「空チャート」を表示してユーザーが原因を推定できなかった)を踏まえ、全層で守るべきエラー処理ルール。

### I-11.1 silent swallow 禁止

`try/except`(Python)/ `try/catch` / `.catch()`(TS)で例外を捕捉した場合、**最低 1 行のログ**(backend: `log.warning` / `log.error`、frontend: `console.warn` / `console.error`)を必ず出す。grep 可能性を確保し、ユーザー報告から「どこで何が起きたか」を即座に特定できるようにする。

例外: 制御フロー目的の予期した失敗(ファイル不存在で空辞書を返す等、ドメイン上正常な状態)に限り、コメントで意図を明記したうえでログ省略可。

### I-11.2 例外の捕捉スコープを最小化

`except Exception:` のような広範囲捕捉は **層境界(provider, router, cache)でのみ許可**。サービス層・ドメインロジック内では具体的な例外型を捕捉する(`except FileNotFoundError`, `except mt5.MT5Error` 等)。

層境界での広範囲捕捉時もコメントで「なぜ広く捕えるか」を明記する。`raise X from e` で原因を残す。

### I-11.3 「空 vs 失敗」の語彙分離

データ取得 API の戻り値で **「成功・該当なし(空)」** と **「失敗(取得不能)」** を区別する。

- backend: HTTP 200 で空配列を返す = 成功・該当なし。失敗は HTTP 4xx/5xx または明示的なステータスフィールド(例: `{ bars, status: 'no_data' | 'fetch_failed' | 'ok' }`)で表現
- frontend hook: `{ data, error, loading }` の三状態を返す。`error !== null` は取得失敗、`data === [] && error === null` は該当なし
- frontend component: 三状態を受けて UI を出し分ける(空表示 / エラーメッセージ / スピナー)

### I-11.4 ユーザー入力起因の失敗は UI に通知

ユーザーのアクション(銘柄切替、advance、エントリー等)が **沈黙的失敗** で終わってはならない。最低限 `notify(...)` 等の非ブロッキング通知でフィードバックする。「空チャート + 通知無し」は禁止。

例:
- 銘柄切替で全 TF が `bars=[]` になった場合 → 「(銘柄)のデータを取得できませんでした。MT5 マーケットウォッチに追加されているか確認してください」
- advance で `new_bars=0` の場合 → 「進めましたが新しい M5 データが取得できませんでした」
- AI 分析でエラー → モーダル内の致命的エラーは `setError` パターン継続、ネットワーク fail は `notify`

通知文言は **「次に何を確認すべきか」** を含めること(原因解決の手がかり)。

#### 通知機構(2026-04-29 確定)

`apps/trade-trainer/frontend/src/contexts/NotifyContext.tsx` + `hooks/useNotify.ts` で実装。

- **Provider 配置**: `App.tsx` の最上位(認証前 LoginPage でも利用可能)
- **toast UI**: Provider 内で `<NotifyToasts />` として組み込み(画面右上に縦積み)
- **API**: `const { notify, dismiss, messages } = useNotify()` / `notify(text, level?: 'info'|'warn'|'error')`
- **寿命**: 既定 5 秒で自動消滅 + クリックで即時消去
- **stack**: 多重通知は積み上げ表示
- **境界外利用**: Provider 外で `useNotify()` を呼ぶと throw(開発時のバグ検知)

致命的(モーダル単位の操作不能)なエラーは引き続きコンポーネント local の `setError` でモーダル内表示する。`notify` は **非ブロッキング toast** 専用。

### I-11.5 trust boundary でのサニティチェック

外部システムからの値が内部前提を満たすか必ず検証する。違反時は `log.warning` で記録し、可能な限り graceful に処理。

該当箇所(現状):
- MT5 → app: `mt5.fetch_ohlc_m5` の戻り値 timestamp が要求 range 内か
- DB → app: `cache.get_cached_ohlc` の timestamp 範囲
- file → memory: `session_store.load` の JSON 構造
- network → state: API レスポンスの想定型 / 値域

新規 trust boundary を追加する際もこのパターンを踏襲する。

### I-11.6 仕様としてのデフォルト値返却を許容

「失敗時は安全側に倒したデフォルトを返す」が **ユーザーに不利益をもたらさない** ケースに限り認める:
- 経済指標フェッチ失敗 → 空配列(チャートは描画される、指標が出ないだけ)
- 設定取得失敗 → デフォルト設定で動く

ただし I-11.1 のログは必ず出す。「ユーザーが選択した銘柄のチャートが出ない」のようにユーザー入力に直接対応する失敗は I-11.4 に従い必ず通知する(デフォルト値返却で誤魔化さない)。

#### notify 要否の判断基準(I-11.4 / I-11.6 をまたぐ運用ガイド)

各 catch ブロックは以下のフローで判断する:

| シナリオ | 通知 | 備考 |
|---|---|---|
| ユーザー入力に直接対応する失敗(銘柄切替で全 TF 空 / advance / エントリー / 見送り送信失敗) | **必ず notify** | I-11.4 |
| バックグラウンド fetch / 自動再試行 / mount 時取得失敗(`useAuth.me` / `settings.get` / 経済指標 fetch 等) | **ログのみ** | I-11.6 デフォルト fallback の範囲。UI が壊れない限り notify しない |
| 致命的エラー(モーダル単位の操作不能) | **コンポーネント local `setError`** | モーダル内表示(toast でなくフォーム上に永続表示) |

---

# §C. market-data 設計

`packages/market-data/` の OHLC 取得・キャッシュ・プロバイダ抽象を扱う層。frontend は直接呼ばず、backend service / router 経由でのみ利用する。

## C.1 公開 API

`market_data.accessor`(モジュール上の関数のみ。クラス化しない方針):

| 関数 | 用途 | 備考 |
|---|---|---|
| `configure(db_path, provider=None)` | アプリ起動時に 1 回 | provider=None ならキャッシュ参照のみ |
| `get_ohlc(symbol, timeframe, from_dt, to_dt) -> DataFrame` | 通常の OHLC 取得 | UTC-aware index |
| `get_latest(symbol, timeframe, n_bars)` | リアルタイム用(trade-live で使用) | provider 接続必須 |
| `get_symbol_digits(symbol) -> int` | 価格表示桁数 | provider 不在時はヒューリスティック |
| `shutdown()` | アプリ終了時 | provider を切断 |

backend の `routers/chart.py` 等は `from market_data.accessor import get_ohlc` のみで利用する。

## C.2 内部構造

```
accessor.py    ← 公開エントリ。session オープン + fetcher 呼び出し
fetcher.py     ← TF 別キャッシュ戦略(M5 取得 + 上位足 resample)
cache.py       ← SQLAlchemy 経由の SELECT / UPSERT、サニティチェック
timeframes.py  ← TIMEFRAME_MINUTES 表 + resample_ohlc(M5 → 上位足)
providers/
  base.py      ← DataSourceProvider 抽象クラス
  mt5.py       ← MetaTrader5 Python API 実装(Windows 専用)
```

## C.3 取得フロー(ver 1.59: chart-stack 単一エンドポイント)

`backend.routers.chart.chart_stack` が全 TF を直列に取得する。キャッシュなし。

### C.3.1 アルゴリズム

```python
TF_ORDER = ["M5", "M15", "H1", "H4", "D1", "W1", "MN1"]
BARS_BY_TF = {"M5": 500, "M15": 300, "H1": 200, "H4": 150, "D1": 100, "W1": 60, "MN1": 24}
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
        live = _aggregate_one_bar(slice_for_live, tf)  # 1 行 DataFrame
    else:
        live = empty_df

    full = concat([confirmed, live]).tail(bars_count)
    stacks.append({"timeframe": tf, "bars": df_to_bars(full)})
    prev_tf_df = full

return ChartStackResponse(symbol, current_position, stacks)
```

### C.3.2 設計の要点

- **直列フェッチ**: MT5 Python API は同一銘柄に対して並列リクエストをシリアライズする特性があるため、frontend で 7 並列にしても効果なし。backend で順次に処理する方が制御しやすく、ユーザーには下位 TF から表示が現れる UX
- **下位 TF 連鎖集約**: 上位 TF の最新バーは前段で確定したフル DataFrame(confirmed + live)から `[boundary, current_position]` 範囲を `resample_ohlc` で 1 行に集約する。これにより `current_position` 以降の broker データが混入しない(未来漏れ防止)
- **broker の in-progress バーは捨てる**: `raw[raw.index < boundary]` で boundary より前の確定済みのみ採用
- **キャッシュなし**: `ohlc` テーブルは本フローからは読み書きしない(将来再導入候補)。MT5 ターミナル側キャッシュで 2 回目以降は十分速い
- **`FACTOR = 1.5`**: bars × tf_minutes に掛ける単純係数(週末・祝日吸収のため)。TF 別に分岐させない

### C.3.3 末尾の安全策

- 各 `provider.fetch_ohlc` は失敗時 `log.warning` で記録し、空 DataFrame を返す([§B I-10](#i-10-observability-の最低ライン))
- 1 つの TF が失敗しても、その TF だけ空 bars で返し、他の TF は継続(I-11.1 / I-11.3)

## C.5 プロバイダ抽象

### C.5.1 `DataSourceProvider`(`providers/base.py`)

```python
class DataSourceProvider(ABC):
    SOURCE_NAME: str
    initialize() -> bool
    shutdown()
    is_connected() -> bool
    fetch_ohlc(symbol, timeframe, from_dt, to_dt) -> DataFrame   # 任意 TF(ver 1.58 で追加)
    fetch_ohlc_m5(symbol, from_dt, to_dt) -> DataFrame           # 後方互換、内部で fetch_ohlc("M5") に委譲
    fetch_latest_m5(symbol, n_bars) -> DataFrame
    get_available_range(symbol) -> (dt, dt) | None
    get_symbol_digits(symbol) -> int | None
```

DataFrame の規約:
- index: `timestamp` (UTC tz-aware)
- columns: `open, high, low, close, volume`
- 任意 TF を返す(ver 1.58: ライブバーは呼び出し側で「一つ下の TF」から集約)

### C.5.2 `MT5Provider`(`providers/mt5.py`)

- Windows 専用(`if sys.platform != 'win32': raise ImportError`)
- `mt5.copy_rates_range()` を呼ぶ
- 銘柄名解決: 接尾辞付き(例 `USDJPY.a`)を `_resolve_symbol` でキャッシュ付き解決
- **マーケットウォッチ自動追加**: `_resolve_symbol` 内で `mt5.symbol_select(resolved, True)` を呼ぶ。MT5 は MarketWatch に追加されていない銘柄に対して `copy_rates_range` が silent に空配列を返すため、明示的に MarketWatch へ追加する。symbol_select が失敗した場合は `log.warning` で検知できるようにする
- **datetime は必ず tz-aware UTC で渡す**([§B I-1.2](#i-12-mt5-プロバイダ境界))
- 戻り値の Unix タイムスタンプを `pd.to_datetime(unit='s', utc=True)` で UTC-aware に
- サニティチェック: 戻り値 range が要求 range の ±2h 以内か log warn
- 銘柄解決失敗(`symbols_get` でも見つからない)時は `log.warning` で検知できるようにする(broker 側に該当銘柄が無い徴候)

新プロバイダ(Dukascopy 等)を追加する場合は `DataSourceProvider` を実装する。

## C.6 resample 規約(ライブバー集約用)

`timeframes.resample_ohlc(df, dst_tf)` は **任意 src TF の DataFrame** を `dst_tf` の集約ルールで再サンプルする。ver 1.58 で M5 専用前提を撤廃し src 非依存にした。主用途は **進行中バーを「一つ下の TF」から計算** すること(I-2)。

- `closed='left', label='left'`(バーは開始時刻ラベル、対応窓は `[start, start+tf_delta)`)
- 集約: `open=first, high=max, low=min, close=last, volume=sum`
- 出力もすべて UTC-aware index

`MN1` のリサンプル規則は `MS`(Month Start)。月毎に集約され、入力 DataFrame に含まれる各月のバーが 1 本に集約される。

`TIER_BELOW: dict[str, str]` がライブバー計算チェーンを定義する: `M15→M5 / H1→M15 / H4→H1 / D1→H4 / W1→D1 / MN1→W1`。

## C.7 設定(env)

| 変数 | 用途 |
|---|---|
| `TRAINER_USE_MT5` | `false` で MT5 無効(キャッシュ参照のみ) |
| `TRAINER_AI_MOCK` | AI 関連、market-data には影響なし |
| db_path | 既定 `apps/trade-trainer/backend/trading.db`(env で上書き可) |

## C.8 既知の落とし穴

| 事象 | 原因 | 対処 |
|---|---|---|
| 「TF ごとに価格が違って見える」 | 上位 TF cache が古い M5 状態で resample されたまま | `tf_extremes[1] <= to_dt` の右リフレッシュで自動収束(ver 1.53) |
| 「足進めても M5 だけ動く」 | 上位 TF cache の右拡張が `last_bar_end > to_dt - tf_delta` に縛られていた(旧仕様) | 修正済(`tf_extremes[1] <= to_dt`) |
| 「MT5 から空が返り続けて遅い」 | session current_position が available data の範囲外 | broker 接続とブローカーのヒストリカル範囲を確認。各 fetch は数百 ms で完結するため致命的ではない |
| 「ブローカー時刻 ≠ UTC で価格がズレる」 | naive datetime を MT5 に渡していた(過去事故) | tz-aware で渡す(現状)。`mt5.fetch_ohlc_m5` の sanity warn でも検知 |

---

# §D. backend 設計

`apps/trade-trainer/backend/` の FastAPI アプリ。HTTP ルーティング(routers)とドメインロジック(services)を分離。

## D.1 レイヤ構成

```
main.py
   │  create_app() / lifespan
   ▼
routers/                 ← HTTP ハンドラのみ。例外→HTTP コード変換 + service ディスパッチ
   ├─ auth.py            ← パスワード認証(Starlette session)
   ├─ sessions.py        ← セッション CRUD / メモ / 振り返り
   ├─ chart.py           ← GET chart-stack / POST advance / GET chart-history
   ├─ trades.py          ← エントリー / 決済 / 取得
   ├─ drawings.py        ← 描画 CRUD
   ├─ events.py          ← 経済指標取得
   ├─ settings.py        ← アプリ設定
   ├─ ai_analysis.py     ← AI 分析 run / history / report
   └─ _helpers.py        ← session 検証 helper など共通(2026-04-29)

services/                ← ドメインロジック。HTTP に依存しない
   ├─ session_store/     ← セッションファイル I/O(2026-04-29 でパッケージ分割)
   │  ├─ __init__.py     ←   公開 API(load / save_* / create_session / rename_dir / delete_*)
   │  ├─ io.py           ←   低レベル I/O(read/write_session_json / dir 操作 / Conflicted-copy 検知)
   │  └─ serialize.py    ←   dataclass ↔ dict 変換(_meta_to_dict / _aggregate_to_dict / from_dict)
   ├─ session_models.py  ← dataclass(SessionMeta / Trade / Candidate / FinalDecision / Drawing 等)
   ├─ candidates.py      ← 候補追加削除(2026-04-29 で sessions.py から分離)
   ├─ post_eval.py       ← 事後評価(MFE / MAE / R-pnl / 3 段階観察)
   ├─ ai_input_builder.py ← AI 送信 payload 構築
   ├─ ai_client.py       ← Anthropic SDK ラッパ + モック
   ├─ ai_storage.py      ← AI 履歴(index.json + report.md)+ payload hash キャッシュ
   └─ memo_templates.py  ← data/memo-templates の起動時ロード

utils/                   ← 共通 utility(2026-04-29 で抽出)
   ├─ json_io.py         ← json_default(datetime/Decimal) / read_json / write_json
   ├─ datetime.py        ← ensure_aware_utc(dt) ほか tz 補助(I-1 不変条件)
   └─ http.py            ← HTTPException ファクトリ(not_found / bad_request)

schemas/                 ← Pydantic レスポンス・リクエスト型
auth.py                  ← パスワード照合
config.py                ← Settings(env) + Depends で注入
deps.py                  ← DB session の Depends
```

責務原則:
- **router は ifelse / 例外→HTTP の翻訳 + service 呼び出しに留める**(20-30 行/ハンドラ程度)
- **service は HTTP の Request / Response を知らない**(将来 CLI 化する場合の見通し)
- **session_store は他 service から呼ばれる窓口**。ファイル I/O はここに閉じる
- **utils は state-less な共通 helper のみ置く**。ドメイン知識を持たない(知識を持つコードは services へ)

## D.2 セッションファイル構造

`data/sessions/{dir}/` の典型レイアウト([§17 データモデル](./spec/17-data-model.md) 参照、ver 1.54 で統合):

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
  "time_filter": null,
  "indicator_config_id": null,
  "trade": { ... } | null,             // エントリー時のみ
  "final_decision": { "has_entry": ..., "skip_reason": ... } | null,
  "drawings": [ ... ],                 // 描画オブジェクト配列
  "holding_memos": [ { "timestamp": "...", "memo": "..." } ]  // real モード用
}
```

ディレクトリ名は識別に使わない(rename される)。`note.md` と `candidates/*.md` は自由記述・1ファイル1テキストで分割を維持(エディタ編集の利便性のため)。

### 後方互換

ver 1.54 以前の旧形式(`trade.json` / `final_decision.json` / `drawings.json` / `holding_memos.jsonl` が分かれていた)は、**読み出し時にフォールバック** で対応する。session.json に対応フィールドがなく、かつ旧ファイルが存在する場合だけ旧ファイルを読む。次回の save 時に統合形式で書き戻され、旧ファイルは削除される(自然移行)。

## D.3 session_store の責務(2026-04-29 でパッケージ分割)

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

書き込みは `Path.write_text` の単純書き込み(ver 1.54 で atomic write を撤去)。`SessionAggregate` は `meta + note + candidates + trade + final_decision + drawings + holding_memos` の集約 dataclass。

## D.4 主要エンドポイントのフロー

### D.4.1 GET `/sessions/{id}/chart` (`routers/chart.py:get_chart`)

```
1. session_store.load(id)         # 404 if not found
2. to_dt = current_position (or 'before' query)
3. 解析的に from_dt を計算:
     fetch_minutes = bars * tf_minutes * WEEKEND_FACTOR  # 既定 2(週末・祝日吸収)
     from_dt = to_dt - timedelta(minutes=fetch_minutes)
     df = market_data.get_ohlc(symbol, tf, from_dt, to_dt)
4. df.tail(bars) → ChartResponse(bars[], current_position, timeframe)
   - 取得本数 < 要求 bars でも空応答にしない(取れた分だけ返す)
   - df 空 / 例外時は log.warning + 空 bars 返却
```

`get_ohlc` の内部は [§C](#c-market-data-設計) 参照。ループの全反復で `log.debug`、最終失敗時は `log.warning`。

### D.4.2 POST `/sessions/{id}/advance` (`routers/chart.py:advance_session`)

`bars` パラメータは **M5 換算本数**(frontend が entryTf → M5 比率を掛けて算出する。仕様 §5.1.1)。

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

frontend は `new_bars` で M5 を即時マージ + 各上位 TF を `bars=2` で末尾再取得。詳細は [§E.6.2 handleAdvance](#e62-handleadvance)。

### D.4.3 POST `/sessions/{id}/skip` (`routers/sessions.py:skip_session`)

```
1. ensure session exists
2. fd = FinalDecision(has_entry=False, skip_reason=body.reason)
3. session_store.save_final_decision + rename_dir
4. _maybe_settle(session_id)  # 横断メモ非空なら settled_at セット
5. return SessionResponse
```

### D.4.4 POST `/sessions/{id}/trade/enter` (`routers/trades.py:enter_trade`)

```
1. ensure session, no active trade
2. _upsert_candidate_on_entry: 銘柄別メモを初期挿入(なければ)
3. trade = Trade(direction, sl, tp, entry_price=current_price, ...)
4. session_store.save_trade
5. fd = FinalDecision(has_entry=True)
6. session_store.save_final_decision + rename_dir
7. return TradeResponse
```

### D.4.5 GET `/sessions/{id}/post-review` (`routers/sessions.py:get_post_review`)

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

ver 1.50 で `considered_styles` / 見送り代理 R は撤廃。見送り・候補振り返りは pips のみ。

### D.4.6 POST `/sessions/{id}/ai-analysis/run` (`routers/ai_analysis.py:run_ai_analysis`)

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

[§B I-9](#i-9-ai-分析の送信ガードレール) で送らないものを定義。

## D.5 認証

`auth.py` の依存性注入(`Depends(verify_session)`)を全 router に適用(auth router を除く)。Starlette `SessionMiddleware` で password 照合済セッション ID を cookie に保持。

`TRAINER_APP_PASSWORD` env で変更可能。

## D.6 起動時の DB マイグレーション

`init_db(db_path)` は `Base.metadata.create_all` を呼ぶ。既存 DB は **Alembic マイグレーション** で進める:

```
cd packages/shared-schema && uv run alembic upgrade head
```

新規スキーマ変更時は Alembic マイグレーションファイルを `migrations/versions/` に追加し、`down_revision` を最新 head に紐付ける。

## D.7 ログ設定

uvicorn 標準のロガーに従う:
- `logger = logging.getLogger(__name__)` で各モジュールに logger を作る
- `--log-level info` 起動で stdout に出る(本番は journald / file 経由を想定)
- 観測性ガイドラインは [§B I-10](#i-10-observability-の最低ライン)

## D.8 既知の落とし穴

| 事象 | 原因 | 対処 |
|---|---|---|
| advance しても new_bars=0 | 進めた range の M5 がキャッシュにない & MT5 が応答しない | MT5 接続確認 / ブローカーのヒストリカル範囲を確認 |
| post-review で空応答 | 候補がない or trade も skip も未確定 | 仕様通り(対象なしを示す) |
| AI 分析が遅い | 同 payload キャッシュ未ヒット + max_tokens 大 | `TRAINER_AI_MOCK=true` でテスト時バイパス |
| セッションファイル破損 | 書き込み中の中断 or 外部編集 | `session_store.load` が `None` を返す → 404 |

---

# §E. frontend 設計

`apps/trade-trainer/frontend/` の React アプリ。1 画面統合フロー(§6.1)で「分析→保有→振り返り」をすべて `SessionPage` 内で処理する。

## E.1 画面構成

```
App.tsx
   │  authenticated=false → LoginPage
   │  view='list'         → SessionListPage
   ▼  view='session'
SessionPage(統合フロー)
   ├─ 一覧画面に戻るボタン
   ├─ ヘッダー(セッション名 / 銘柄 / TimeframeSelector / メモボタン)
   ├─ メインエリア(マルチ TF 縦積みチャート + overlays)
   ├─ サイドバー(IndicatorPanel / DrawingTools / TradePanel / 各種パネル)
   └─ モーダル(MemoPanel / SkipEntryModal / Modal)
```

`SessionPage` の中身は **phase によって出し分け**(§E.3 参照)。

## E.2 ディレクトリ構成

```
src/
├─ App.tsx, main.tsx        ← ブート / 認証 / 簡易ルーティング
├─ pages/
│  ├─ LoginPage.tsx
│  ├─ SessionListPage.tsx
│  └─ SessionPage.tsx        ← 主要(現状 600+ LOC、Phase C で分解予定)
├─ components/
│  ├─ Chart.tsx              ← lightweight-charts ラッパ(forwardRef + useImperativeHandle)
│  ├─ DrawingOverlay.tsx     ← 描画 SVG オーバーレイ
│  ├─ DrawingTools.tsx       ← 描画ツール選択 UI
│  ├─ TradePanel.tsx         ← エントリー / 決済 / SL/TP 表示
│  ├─ MemoPanel.tsx          ← メモモーダル(銘柄別 + 横断、debounce 保存)
│  ├─ AiAnalysisPanel.tsx    ← AI 分析(レポート + 履歴 + 比較)
│  ├─ PostReviewPanel.tsx    ← 振り返り(MFE/MAE/R + 振り返りメモ)
│  ├─ SkipEntryModal.tsx     ← 見送り確認モーダル
│  ├─ Modal.tsx              ← 汎用モーダル
│  ├─ EventOverlay.tsx       ← 経済指標オーバーレイ
│  ├─ IndicatorPanel.tsx, TimeframeSelector.tsx
├─ hooks/
│  ├─ useCharts.ts            ← マルチ TF バー管理
│  ├─ useDrawings.ts          ← 描画 CRUD
│  ├─ useDrawingInteraction.ts ← 描画状態機械(drawing-tools.md。ver 1.55 で union+dispatch に統合)
│  ├─ useEconomicEvents.ts
│  ├─ useChartRefCache.ts     ← Chart の ref を TF 別に保持
│  └─ useAuth.ts
├─ api/
│  ├─ types.ts                ← レスポンス・リクエスト型
│  └─ client.ts               ← fetch ラッパ + エンドポイント定義
├─ drawing/                   ← drawing-tools.md
│  ├─ types.ts, state.ts, tools/, visibility.ts
├─ indicators/                ← インジケーター(SMA / EMA / RSI 等)
└─ utils/
```

## E.3 SessionPage のフェーズ導出

`SessionPage.tsx` で session / trade 状態から phase を**導出**(state として持たない):

```ts
phase = activeTrade
  ? 'holding'
  : (latestTrade && latestTrade.exit_time) ? 'reviewing'
  : 'analyzing'
```

phase 別の表示要素:

| 要素 | analyzing | holding | reviewing |
|---|---|---|---|
| 銘柄ドロップダウン | ✓ | 固定表示 | 固定表示 |
| `<TradePanel>` | エントリー UI | exit UI + active trade 表示 | 非表示 |
| `<PostReviewPanel>` + `<AiAnalysisPanel>` | - | - | ✓ |
| 「見送り」「全候補見送り」ボタン | ✓ | - | - |
| `▶ +1本 / +5本` | ✓ | ✓ | ✓(続き観察) |

`session.is_settled`(横断メモが書かれた)は phase と独立。決着済みでもメモ・描画は編集可。

## E.4 状態の所有(2026-04-29 で hook 分解済)

| state | 由来 | 更新タイミング |
|---|---|---|
| `session, activeTrade, latestTrade, phase` | **`useSessionFetch(sessionId)`** | mount / advance / enter / exit / skip / メモ・名前変更時 |
| `entryDraft, entryPlacing, advancing, loading` | **`useTradeFlow(...)`** | エントリー draft 編集 / 操作中フラグ |
| 通知メッセージ(toast) | **`NotifyContext`** + `useNotify()` | 各種失敗 / 成功通知 |
| `barsByTf, loadingByTf, currentPrice` | `useCharts` | 銘柄/TF 切替・advance |
| クロスヘア同期 | `useCrosshairSync` hook | hook 内に閉じる(ver 1.55 で一元化) |
| `analyzingSymbol, symbolMode, entryTf, activeTf, hiddenTfs, memoOpen, skipping, confirmSkipAll, skipAllReasonDraft, hoveredEvent` | SessionPage local | UI 配置に直結する分のみ。`symbolMode: 'all' \| 'star'`(ver 1.62) はヘッダ銘柄セレクタの絞り込みモード |

### 新 hook の契約(2026-04-29 確定)

#### `useSessionFetch(sessionId)`

```ts
function useSessionFetch(sessionId: string): {
  session: TradeSession | null
  setSession: (s: TradeSession | null) => void
  activeTrade: TradeResponse | null
  setActiveTrade: (t: TradeResponse | null) => void
  latestTrade: TradeResponse | null
  setLatestTrade: (t: TradeResponse | null) => void
  refresh: () => Promise<void>          // 3 つを並列再取得
  phase: 'analyzing' | 'holding' | 'reviewing'  // 派生
}
```

責務: session / activeTrade / latestTrade の取得 + refresh + phase 導出。mount 時に `refresh()` 実行。

#### `useTradeFlow(params)`

```ts
function useTradeFlow(params: {
  sessionId: string
  currentSymbol: string
  entryTf: string
  reloadStack: () => Promise<void>
  refreshSession: () => Promise<void>
  setActiveTrade: (t: TradeResponse | null) => void
  setLatestTrade: (t: TradeResponse | null) => void
}): {
  entryDraft: { sl: number | null; tp: number | null }
  setEntryDraft: ...
  entryPlacing: 'sl' | 'tp' | null
  setEntryPlacing: ...
  advancing: boolean
  loading: boolean
  handleEnter: (args: { direction; price; sl; tp }) => Promise<void>
  handleExit: (price: number, reason: string) => Promise<void>
  handleAdvance: (n?: number) => Promise<void>
  handleSkip: (reason: string) => Promise<void>
}
```

責務: トレード操作系 state + handler 4 つ。内部で `useNotify()` を呼んで成功/失敗を通知。`useSessionFetch` の setter / refresh は **props 注入** で受ける(双方向依存を避ける)。

#### `useNotify()`

```ts
function useNotify(): {
  messages: NotifyMessage[]
  notify: (text: string, level?: 'info' | 'warn' | 'error') => void
  dismiss: (id: number) => void
}
```

詳細は [§B I-11.4](#i-114-ユーザー入力起因の失敗は-ui-に通知) 参照。

## E.5 `useCharts` の契約

```ts
useCharts(sessionId, symbol, timeframes, entryTf): {
  barsByTf: Record<string, OhlcBar[]>,    // TF 別バー配列。timestamp 昇順
  currentPrice: number | null,             // entryTf の最新 close
  reloadAll: () => Promise<void>,          // 銘柄/TF 集合切替時の全 TF 再取得
  loadMoreHistory: (tf, earliest) => Promise<void>,  // 過去バー追加取得(左端到達時)
  mergeM5Bars: (newBars) => void,          // advance 後の楽観的 M5 マージ
  refreshTails: (tfBars) => Promise<void>, // advance 後の per-TF 末尾再取得
}
```

不変条件:
- `barsByTf[tf]` は **timestamp 昇順** で **重複なし**(`mergeBarsTail` が保証)
- `requestIdRef` で stale 検知:銘柄 / TF 集合切替時に `++requestId` し、古い in-flight 結果を捨てる
- 失敗時は `console.warn` で残す(silent failure を作らない、[§B I-10](#i-10-observability-の最低ライン))
- `mergeM5Bars` は M5 のみを更新。他 TF は影響しない
- `refreshTails(tfBars)` は per-TF で `bars` 数を指定可能(M5 は `n+2` 程度、上位は 2 が標準)

## E.6 主要フロー

### E.6.1 ページロード

```
SessionPage mount
  ↓ useEffect: api.sessions.get / api.trades.getActive / api.trades.getLatest
  ↓ useCharts: setBarsByTf({})、各 TF を fetchOne で並列取得
  ↓ 各 TF が返ったものから Chart に setData → fitContent(初回のみ)
  ↓ useEconomicEvents: 表示 range が決まったら events を取得 → EventOverlay
  ↓ useDrawings: symbol に紐づく描画を取得 → DrawingOverlay + priceLines
```

### E.6.2 handleAdvance

```
handleAdvance(n=1):                          # n は entry TF のバー数(仕様 §5.1.1)
  setAdvancing(true)
  m5_bars = n × tfMinutes(entryTf) / 5       # M5=1 / M15=3 / H1=12 / H4=48 / D1=288 / W1=2016 / MN1≈8640
  res = await api.chart.advance(sessionId, m5_bars, currentSymbol)
  if res.new_bars.length > 0:
    mergeM5Bars(res.new_bars)   ← 楽観的(round-trip 0)
  await refreshTails({ M5: max(m5_bars+2, 5), M15: 2, H1: 2, ..., MN1: 2 })
  if res.trade_auto_closed:
    setLatestTrade(await api.trades.getLatest)
    setActiveTrade(null)
  setSession(await api.sessions.get)   ← current_position 反映
  setAdvancing(false)
```

体感性能:全 TF キャッシュが warm なら 100ms 以下。ただし entry TF が D1/W1/MN1 で M5 換算が大きい場合、初回 fetch は MT5 から数百〜数千本取得するため数百 ms〜秒オーダーになる(キャッシュ完了後は warm)。

### E.6.3 SL/TP 配置

```
TradePanel「📍 SL を置く」 → setEntryPlacing('sl')
ユーザーがチャートをクリック
  → handleChartClick(price, time, px) が `entryPlacing` をチェック
  → entryDraft.sl = roundToDigits(price)
  → setEntryPlacing(null)
priceLinesForTf が entryDraft を読んで赤線を返す
Chart が新 priceLines プロパティで再描画
```

`entryDraft.sl` の位置から direction を導出:
- `sl < currentPrice` → `buy`
- `sl > currentPrice` → `sell`

「BUY/SELL ボタン」は持たない(SL 位置が方向そのもの、ver 1.50)。

### E.6.4 クロスヘア同期(ver 1.55: `useCrosshairSync` で一元化)

```
useCrosshairSync(chartHandles):
  各 chart に subscribeUserCrosshair で購読
  Chart A でユーザーがクロスヘアを動かす
    → Chart 内 subscribeCrosshairMove(sourceEvent !== undefined) ハンドラ発火
    → 登録済み subscriber(useCrosshairSync 由来)へ通知
  hook が他の Chart B / C に対して setCrosshairTime(time) を呼ぶ
    → 各 Chart は ChartHandle.setCrosshairTime 経由で内部 setCrosshairPosition
    → Chart 自身はこの programmatic move を再 emit しない
    → feedback ループは構造的に発生しない(購読者が origin を知っているため)
```

`SessionPage` はクロスヘア state を持たず、`useCrosshairSync(chartHandles)` を呼ぶだけ。Chart は `onCrosshairTime` / `syncedCrosshairTime` props を持たず、`ChartHandle` の `setCrosshairTime` / `subscribeUserCrosshair` で制御される(read-only-from-React の API)。

### E.6.5 メモ編集

```
M キー or 📝 メモボタン
  → setMemoOpen(true)
MemoPanel:
  銘柄別メモ: noteDraft / memoDraft を debounce 500ms
  → api.sessions.updateNote / updateCandidate
  → onChange callback で setSession
横断メモが空文字以外になると settled_at 自動セット([§4.2.2 参照](./spec/04-session-flow.md))
```

## E.7 Chart コンポーネントの内部

`components/Chart.tsx` は lightweight-charts のラッパ。

### E.7.1 公開する `ChartHandle`(forwardRef)

```ts
{
  api: { priceToY, yToPrice, timeToX, xToTime, setScrollEnabled },
  containerEl: HTMLDivElement | null,
  subscribeRedraw(cb): unsubscribe,        // チャート再描画時にコールバック
  takeScreenshot(): string | null,         // §11.3.1 AI 分析向け PNG dataURL
}
```

### E.7.2 useEffect の責務

| useEffect | 責務 | 依存配列 |
|---|---|---|
| ハンドラ ref 更新(複数) | onChartClick / onMouseMove 等を ref に最新値を入れる | 各ハンドラ |
| メイン初期化(L149-276 級) | チャート生成 / 各種購読 / cleanup | `[]`(マウント時のみ) |
| クロスヘア同期 | `ChartHandle.setCrosshairTime` から呼ばれて近接バー検索 → setCrosshairPosition(命令的、useEffect 不要) | — |
| **描画**(bars 反映) | `series.setData(bars)` または右端伸長時は `series.update()`。初回(tfChanged 経路)は `fitContent` を走らせる | `[bars, timeframe]` |
| 価格精度 | `priceFormat` を digits に追従 | `[digits]` |
| priceLines 差分更新 | 削除→追加で priceLines を反映 | `[priceLines]` |
| インジケーター差分更新 | 種別ごとに addLineSeries / removeSeries | `[indicators, bars]` |

**設計原則(ver 1.58 で導入)**: 銘柄切替は SessionPage 側で `<Chart key={`${tf}-${symbol}`}>` の **React remount** で扱う。lightweight-charts の series/timeScale/各種 ref が一度にリセットされるため、Chart 内で `bars` と `symbol` の到着順序差から intent を推測する必要がない(過去の差分推測ロジックがこの順序差バグの温床だった)。Chart は「同一インスタンス内のバー差分反映」だけを担う。

トレードオフ: 銘柄切替時にチャートのズーム / パン位置がリセットされる(初回 fitContent からやり直し)。同銘柄内では維持される。

ハンドラは ref 経由で常に最新値を呼ぶ(マウント時の購読関数は閉包なので)。

### E.7.3 クロスヘア API(ver 1.55)

`ChartHandle` 経由で **命令的に** 制御:

```ts
ChartHandle = {
  // ...既存...
  setCrosshairTime(time: number | null): void   // 同期表示。null でクリア
  subscribeUserCrosshair(cb): () => void          // ユーザー操作のみ通知(programmatic は通知しない)
}
```

内部では `subscribeCrosshairMove` のハンドラに `param.sourceEvent !== undefined` フィルタを入れて、purely-user-driven なイベントだけを subscriber に流す。`setCrosshairTime` で発火した programmatic な move は subscriber に来ないため、複数 Chart 間の feedback ループは構造的に発生しない。

## E.8 描画システム

[architecture/drawing-tools.md](./architecture/drawing-tools.md) 参照。`useDrawingInteraction` が状態 (`DrawingState` discriminated union) を保持し、`drawing/state.ts` の `dispatchEvent(state, event, ctx)` が `onChartClick / onMouseMove / onMouseUp / escape / select-tool` を一手に処理する(ver 1.55 で 11 クラス階層から union+switch に統合)。

## E.9 API クライアント

`api/client.ts` のグローバル `api` オブジェクト経由でのみ backend を呼ぶ。型は `api/types.ts`。新エンドポイントを追加する時は両ファイルに対応する。

`request<T>(path, init)` で `credentials: 'include'`(認証 cookie)+ JSON ヘッダーを共通設定。

## E.10 既知の複雑さ

- ~~**`SessionPage` 600+ LOC god component**~~ → 2026-04-29 で `useSessionFetch` / `useTradeFlow` / `useNotify` に分解。SessionPage は orchestration のみを担う 250 行程度に圧縮
- ~~**`entryDraft` 双方向**~~ → `useTradeFlow` に集約済(2026-04-29)
- ~~**クロスヘア二重追跡**~~ → ver 1.55 で `useCrosshairSync` に集約済

### 残課題(将来の別タスク)

- **R3: `Chart.tsx` 責務分割** — 444 行 / useEffect 8 個。座標変換 / series 管理 / イベント中継 / クロスヘア / スクリーンショットを内部 private hook に分解する余地あり
- **R4: `drawing/state.ts` 515 行を tool 別 reducer に分割** — 設計自体は良好(state machine)、ファイルサイズだけが課題。次の描画機能追加時に着手
- **R6: `index.css` 1,274 行のモジュール化** — CSS Modules / Tailwind 移行は別タスク
- **テスト導入(Vitest / Pytest)** — Phase D として別タスク

## E.11 既知の落とし穴

| 事象 | 原因 | 対処 |
|---|---|---|
| 「足進めても上位 TF が動かない」 | backend cache が古いまま、frontend は cache 通りのデータを表示 | 仕様 §I-2 のとおり cache は現在 M5 まで追従するので、`tf_extremes[1] <= to_dt` の右リフレッシュで自動収束する |
| 「TF 間で価格が違う」 | 同上 | 同上 |
| 「クロスヘアが他チャートで Value is null」 | `setCrosshairPosition` に対象 series に存在しない time を渡している | bars 内の最寄り timestamp を使う(現状実装済) |
| 「advance ボタンが無反応」 | `advancing` が true で stuck、または refreshTails が silent fail | DevTools Console を確認、必要なら hard reload |
