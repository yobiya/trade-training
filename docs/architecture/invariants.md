# 横断的な不変条件

← [設計トップ](../ARCHITECTURE.md) | [backend 設計](./backend.md) | [frontend overview](./frontend-overview.md) | [frontend chart](./frontend-chart.md) | [描画システム](./drawing-tools.md)

---

ここに書かれた不変条件は **コード全体で共通に守られるべき前提**。これらが破れるとバグが連鎖する(過去事故あり)。新規コード・修正コードを書く前に、関連する条件を確認すること。

| ID | テーマ | 1 行要約 |
|---|---|---|
| [I-1](#i-1-タイムスタンプは-utc-で統一する) | UTC 規律 | アプリ全体で datetime は UTC、JST 表示は frontend のみ |
| [I-2](#i-2-チャート取得は単一-chart-stack-エンドポイントで直列フェッチ--最新バーは下位-tf-集約) | チャート取得 | 単一 chart-stack で直列フェッチ、最新バーは下位 TF 集約 |
| [I-3](#i-3-ファイル管理-vs-sqlite) | 保存先分離 | ユーザー入力 = ファイル / 機械生成 = SQLite |
| [I-4](#i-4-ファイル書き込みは単純書き込み) | 書き込み単純化 | atomic 書き込みは採用しない |
| [I-5](#i-5-セッションの進行中決着済み状態モデル) | セッション状態 | `settled_at` の有無で進行中 / 決着済みを導出 |
| [I-6](#i-6-current_position-の単一情報源) | 現在位置 | `session.json` の `current_position` が真実 |
| [I-7](#i-7-バー時系列の単調性) | バー昇順 | 全層で時刻昇順・重複なし |
| [I-8](#i-8-上位-tf-のライブバー扱い) | ライブバー | 進行中バーは未確定として扱う |
| [I-9](#i-9-ai-分析の送信ガードレール) | AI ガード | 結果論バイアスを与えない |
| [I-10](#i-10-observability-の最低ライン) | observability | silent failure を作らない |
| [I-11](#i-11-エラー処理--失敗の可視化) | エラー処理 | 6 項目: silent 禁止 / 捕捉スコープ / 空 vs 失敗 / UI 通知 / trust boundary / デフォルト返却 |
| [I-12](#i-12-座標変換と-tf-間-projection) | 座標変換 | 単一 Chart 内は LWC 信頼、TF 間 projection は純粋関数経由 |

---

## I-1. タイムスタンプは UTC で統一する

「naive datetime をブローカー時刻として解釈される」事故が過去に起きた([I-1.4 過去事故](#i-14-過去事故) 参照)。

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

---

## I-2. チャート取得は単一 chart-stack エンドポイントで直列フェッチ + 最新バーは下位 TF 集約

MT5 Python API はリクエスト処理がシリアライズされる特性があり、TF 別の並列取得や `ohlc` テーブル経由の resample キャッシュを挟むと cold load で 20 秒を超えやすい。これを避けるため、現行は **キャッシュ層を介さず、単一エンドポイントから下位 TF → 上位 TF の順で直列に取得** し、各 TF の最新バーは「一つ下の TF」の結果から集約する設計を採る。

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

詳細は [`backend.md` § C 取得フロー](./backend.md#c-取得フロー)。

---

## I-3. ファイル管理 vs SQLite

ユーザー入力 / 機械生成キャッシュで保存先を分ける方針:

| 種別 | 場所 | 同期(Dropbox) |
|---|---|---|
| ユーザー入力(セッション情報・メモ・描画) | `data/sessions/{dir}/` ファイル群 | **対象** |
| ユーザー入力(メモテンプレート) | `data/memo-templates/*.md` | git |
| 機械生成キャッシュ(OHLC・経済指標) | SQLite `trading.db` | 対象外(消耗品) |
| アプリ設定 | SQLite `settings` | 対象外 |

「セッション情報を SQLite に書く」「OHLC をファイルに書く」を **やらない**。混ざるとバックアップ戦略が破綻する。

詳細は [`docs/spec/13-data-storage.md`](../spec/13-data-storage.md)。

---

## I-4. ファイル書き込みは単純書き込み

個人用シングルプロセス + Dropbox 同期前提では、tmp + os.replace の atomic 書き込みは過剰なので採用しない。`Path.write_text` / `json.dumps + write_text` で十分。

ファイル破損リスクを下げる手順:
- 書き込み中のクラッシュは個人運用では実用上稀
- 同期競合は Dropbox 側で `Conflicted copy` ファイルが生成される(`session_store._is_conflict_name` でスキャン除外)

新規にファイル書き込みを追加する場合も同様のシンプル方式を踏襲する。

---

## I-5. セッションの「進行中」/「決着済み」状態モデル

- `SessionMeta.settled_at`: `None` = 進行中、ISO 値あり = 決着済み
- 自動遷移条件(§4.2.2): **トレード決済済 or 見送り確定済 + 横断メモ非空** で自動的に `settled_at` セット
- 逆遷移なし。決着済みでもメモ・描画の編集は継続可

`is_settled` フラグを別カラムで持たない(`settled_at != None` で導出)。

---

## I-6. `current_position` の単一情報源

- 真の値: `session.json` の `current_position`(UTC ISO 文字列)
- frontend の `session.current_position` は **読み取り専用キャッシュ**(advance 後は backend から取得し直す)
- frontend の `barsByTf` の最新バー時刻は表示用であり、これを「現在時刻」と見做さない
- backend のすべての TF 取得は `to_dt = current_position` を起点にする

---

## I-7. バー時系列の単調性

- Provider / cache / frontend いずれも バー配列は **時刻昇順** であること
- `useCharts.mergeBarsTail` は incoming 配列が strictly ascending か検証(違反時 console.warn)
- 結合後もソートして返す(古い値が末尾に紛れる事故を防止)

---

## I-8. 上位 TF の「ライブバー」扱い

- 現在進行中の M5 が含まれる上位 TF バーは **未確定**(close が今後変わる)
- `fetcher.fetch_ohlc` の右端 refresh で毎回再 resample してキャッシュを上書き
- SL/TP 自動判定で「未確定バーの high/low」を当てに行かないこと(リスク: 後続 M5 で高値が更新されて事後的に hit と判定される)
  - 現状は M5 単位で `_check_sl_tp` するため OK だが、将来上位足ベースの判定を追加する際の注意

---

## I-9. AI 分析の送信ガードレール

- §11.9 のとおり、結果論バイアスを避けるため以下は **送らない**:
  - 損益(金額)・勝敗フラグ・決済理由テキスト・機械判定ラベル
- AI 入力スキーマ(`schemas/ai_analysis.py`)から該当フィールドが除かれていること
- ユーザーがメモに「結果論」を書いた場合の扱いは:
  - 仕様: メモには AI に送ってよい内容のみを書く前提([§11.3.3](../spec/11-ai-analysis.md#1133-メモ全文))
  - 実装ガード: backend では追加処理しない(プロンプト規範に委ねる)

---

## I-10. observability の最低ライン

[Phase A 観測性整備] により、以下を満たす:

- `chart.py` の chart fetch 試行と結果(rows/失敗)が `log.debug` / `log.warning` で記録される
- `cache.get_cached_ohlc` 範囲外データを `log.error` する
- `mt5.fetch_ohlc_m5` 呼び出しが `log.debug`(件数記録)、TZ 異常を `log.warning` する
- frontend `useCharts.refreshTails` / `fetchOne` の失敗が `console.warn` で残る

新たに失敗が沈黙するパスを追加しない(I-11.1 で具体化)。本項はログ要件の最低限を扱い、ユーザー通知や「空 vs 失敗」の区別は次の I-11 が規定する。

---

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

#### 通知機構

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

## I-12. 座標変換と TF 間 projection

過去事故: `LowerTfRangeOverlay`(下位 TF レンジ背景帯)を 4 連続で実装失敗した。原因はライブラリの `timeToCoordinate` が条件次第で null を返す経路と、bar 配列ベースの線形外挿経路の 2 経路が暗黙併存していたこと。これを未然防止するため、座標変換に関する不変条件を 3 点固定する。

### I-12.1 単一 Chart 内の座標変換は LWC を信頼

同一 Chart instance の中で `time ↔ logical ↔ pixel` を変換するときは lightweight-charts の API (`timeToCoordinate` / `coordinateToTime` / `logicalToCoordinate` / `coordinateToLogical`) を素直に使う。

API ごとの挙動は [`frontend-chart.md` § lightweight-charts 境界カタログ](./frontend-chart.md#lightweight-charts-境界カタログ) に集約する。

### I-12.2 TF 間 projection は純粋関数経由のみ

「下位 TF の visible range を上位 TF pane に重ねる」のように **複数 Chart instance をまたぐ座標変換** では、ライブラリの `timeToCoordinate` を使わない。代わりに次の純粋関数経路を使う:

```
lower の visible logical
  → (lower の bars + tfSec の線形補間) → 時刻
  → (upper の bars + tfSec の線形補間) → upper の logical
  → upper.logicalToCoordinate(...) → pixel
```

理由: `timeToCoordinate` は upper TF の bar 境界に時刻が乗らないと null を返す。null 時のフォールバックを足すと「正常経路と fallback 経路で挙動が変わる」温床になり、TF 間で安定しない(LowerTfRangeOverlay 連続失敗の直接原因)。`logicalToCoordinate` は範囲外 logical でも線形外挿で px を返すため、**唯一の px 変換 API** として依存する。

### I-12.3 範囲外 logical はクランプしない

`logicalToCoordinate(logical)` は `logical < 0` や `logical > lastIdx` でも線形外挿で px を返す。Overlay 側でクランプや「null だから諦める」ような処理を入れず、px 値を SVG に渡したうえで pane の clip に任せる。これによりブローカーのヒストリ制限で上位 TF のバーが少なく、下位 TF の時刻範囲が上位 TF のデータ範囲を超えるケース(W1 / MN1 等で頻発)も自然に処理される。
