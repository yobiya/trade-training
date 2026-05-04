# frontend overview

← [設計トップ](../ARCHITECTURE.md) | [横断不変条件](./invariants.md) | [Chart 関連](./frontend-chart.md) | [描画システム](./drawing-tools.md) | [backend 設計](./backend.md)

---

`apps/trade-trainer/frontend/` の React アプリ全体構造。**Chart 関連の詳細(コンポーネント契約・座標系・LWC 境界・overlay 群)は [`frontend-chart.md`](./frontend-chart.md) に分離している**ので、その節の内容はここでは扱わない。

## 目次

- [§A 画面構成](#a-画面構成)
- [§B ディレクトリ構成](#b-ディレクトリ構成)
- [§C SessionPage のフェーズ導出](#c-sessionpage-のフェーズ導出)
- [§D 状態の所有と主要 hook 契約](#d-状態の所有と主要-hook-契約)
- [§E useCharts の契約](#e-usecharts-の契約)
- [§F 主要フロー](#f-主要フロー)
- [§G API クライアント](#g-api-クライアント)
- [§H 既知の複雑さと落とし穴](#h-既知の複雑さと落とし穴)
- [§I テスト戦略と検証粒度](#i-テスト戦略と検証粒度)

---

## §A 画面構成

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

`SessionPage` の中身は **phase によって出し分け**(§C 参照)。1 画面統合フローのため、分析 → エントリー → 保有 → 振り返りはすべて `SessionPage` 内で処理する(画面遷移なし)。

---

## §B ディレクトリ構成

```
src/
├─ App.tsx, main.tsx          ← ブート / 認証 / 簡易ルーティング
├─ pages/
│  ├─ LoginPage.tsx
│  ├─ SessionListPage.tsx
│  └─ SessionPage.tsx         ← 主要(orchestration + JSX)
├─ components/
│  ├─ Chart.tsx               ← lightweight-charts ラッパ(forwardRef + useImperativeHandle)
│  ├─ DrawingOverlay.tsx      ← 描画 SVG オーバーレイ
│  ├─ DrawingTools.tsx        ← 描画ツール選択 UI
│  ├─ EventOverlay.tsx        ← 経済指標オーバーレイ
│  ├─ LowerTfRangeOverlay.tsx ← §5.1.6 下位 TF レンジ背景
│  ├─ TradePanel.tsx          ← エントリー / 決済 / SL/TP 表示
│  ├─ MemoPanel.tsx           ← メモモーダル(銘柄別 + 横断、debounce 保存)
│  ├─ AiAnalysisPanel.tsx     ← AI 分析(レポート + 履歴 + 比較)
│  ├─ PostReviewPanel.tsx     ← 振り返り(MFE/MAE/R + 振り返りメモ)
│  ├─ SkipEntryModal.tsx      ← 見送り確認モーダル
│  ├─ Modal.tsx               ← 汎用モーダル
│  └─ IndicatorPanel.tsx, TimeframeSelector.tsx
├─ hooks/
│  ├─ useCharts.ts             ← マルチ TF バー管理(§E)
│  ├─ useDrawings.ts           ← 描画 CRUD
│  ├─ useDrawingInteraction.ts ← 描画状態機械(drawing-tools.md)
│  ├─ useEconomicEvents.ts
│  ├─ useChartRefCache.ts      ← Chart の ref を TF 別に保持(詳細は frontend-chart.md)
│  ├─ useCrosshairSync.ts      ← クロスヘア同期(詳細は frontend-chart.md)
│  ├─ useSessionFetch.ts       ← session / activeTrade / latestTrade / phase
│  ├─ useTradeFlow.ts          ← トレード操作 state + handler
│  ├─ useEntryMarkers.ts       ← Trade.entry_tf チャートの 三角マーカー導出(§D.4)
│  ├─ useSessionShortcuts.ts   ← M / [ / ] / F / S キーボードショートカット(§D.5)
│  ├─ useNotify.ts             ← toast 通知
│  └─ useAuth.ts
├─ chart/                     ← Chart 関連の純粋ロジック(モジュールスコープ)
│  └─ chartStackCache.ts      ← /chart-stack レスポンス LRU(詳細は §H)
├─ api/
│  ├─ types.ts                 ← レスポンス・リクエスト型
│  └─ client.ts                ← fetch ラッパ + エンドポイント定義
├─ utils/
│  ├─ datetime.ts              ← formatJST / formatJSTDate
│  ├─ bars.ts                  ← `nearestBarTime` 等のバー配列ユーティリティ
│  └─ priceLines.ts            ← `priceLinesForTf` (drawings + entryDraft + Trade → PriceLine[])
├─ contexts/
│  └─ NotifyContext.tsx        ← toast 通知 Provider
├─ drawing/                    ← drawing-tools.md
│  ├─ types.ts, state.ts, tools/, visibility.ts
└─ indicators/                 ← インジケーター(SMA / EMA / RSI 等)
```

---

## §C SessionPage のフェーズ導出

`SessionPage.tsx` で session / trade 状態から phase を **導出**(state として持たない):

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

`session.is_settled`(横断メモが書かれた)は phase と独立。決着済みでもメモ・描画は編集可([invariants.md I-5](./invariants.md#i-5-セッションの進行中決着済み状態モデル))。

---

## §D 状態の所有と主要 hook 契約

| state | 由来 | 更新タイミング |
|---|---|---|
| `session, activeTrade, latestTrade, phase` | **`useSessionFetch(sessionId)`** | mount / advance / enter / exit / skip / メモ・名前変更時 |
| `entryDraft, entryPlacing, advancing, loading` | **`useTradeFlow(...)`** | エントリー draft 編集 / 操作中フラグ |
| 通知メッセージ(toast) | **`NotifyContext`** + `useNotify()` | 各種失敗 / 成功通知 |
| `barsByTf, loadingByTf, currentPrice` | `useCharts` | 銘柄/TF 切替・advance |
| クロスヘア同期 | `useCrosshairSync` hook | hook 内に閉じる |
| `analyzingSymbol, symbolMode, focusedTf, hiddenTfs, memoOpen, skipping, confirmSkipAll, skipAllReasonDraft, hoveredEvent` | SessionPage local | UI 配置に直結する分のみ。`focusedTf` は §5.1.5 フォーカス TF。`symbolMode: 'all' \| 'star'` はヘッダ銘柄セレクタの絞り込みモード |

### D.1 `useSessionFetch(sessionId)`

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

### D.2 `useTradeFlow(params)`

```ts
function useTradeFlow(params: {
  sessionId: string
  currentSymbol: string
  focusedTf: string
  reloadStack: () => Promise<void>
  setSession: (s: TradeSession | null) => void
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

### D.3 `useNotify()`

```ts
function useNotify(): {
  messages: NotifyMessage[]
  notify: (text: string, level?: 'info' | 'warn' | 'error') => void
  dismiss: (id: number) => void
}
```

詳細は [invariants.md I-11.4](./invariants.md#i-114-ユーザー入力起因の失敗は-ui-に通知)。

### D.4 `useEntryMarkers(displayTrade, barsByTf)`

```ts
function useEntryMarkers(
  displayTrade: TradeResponse | null,
  barsByTf: Record<string, OhlcBar[]>,
): ChartMarker[]
```

責務: §5.5.4 Trade.entry_tf チャートに渡すエントリー / 決済の三角マーカーを `displayTrade` と該当 TF の bars から導出する。

- `displayTrade.entry_tf` の bars 内で `entry_time` / `exit_time` の最寄りバー時刻を `nearestBarTime`(`utils/bars.ts`)で求める
- buy なら下向き(belowBar / arrowUp)、sell なら上向きのエントリー三角。決済時は反対向き、利益なら緑・損失なら赤
- bars 未取得 / displayTrade null のケースは空配列を返す

`barsByTf` 全体ではなく **`displayTrade.entry_tf` の bars だけ参照する** が、現実装は `barsByTf` 全体を deps に取る(SessionPage の useMemo 移植のため)。性能上問題があれば deps を絞るリファクタを検討する。

### D.5 `useSessionShortcuts(params)`

```ts
function useSessionShortcuts(params: {
  phase: 'analyzing' | 'holding' | 'reviewing'
  setMemoOpen: (updater: (v: boolean) => boolean) => void
  setSymbolMode: (updater: (m: 'all' | 'star') => 'all' | 'star') => void
  stepSymbol: (dir: 1 | -1) => void
  toggleCandidate: () => Promise<void>
}): void
```

責務: 仕様書 §7.3 (M) / §6.2 ([, ], F, S) のキーボードショートカットを `window` に attach する。INPUT / TEXTAREA / contenteditable へのフォーカス中はスキップ。`M` はフェーズ問わず、`[ / ] / F / S` は `phase === 'analyzing'` のみ有効。

cleanup で `removeEventListener` を確実に呼ぶ。`stepSymbol` / `toggleCandidate` は呼び出し側で useCallback 安定化したものを渡す前提。

---

## §E `useCharts` の契約

```ts
useCharts(sessionId, symbol, timeframes, focusedTf, currentPosition): {
  barsByTf: Record<string, OhlcBar[]>,        // TF 別バー配列。timestamp 昇順
  loadingByTf: Record<string, boolean>,       // TF 別 loading フラグ
  currentPrice: number | null,                // focusedTf の最新 close
  reloadStack: () => Promise<void>,           // advance 直後の強制再取得(キャッシュバイパス)
  loadMoreHistory: (tf, earliestUnix) => Promise<void>,  // 左端到達時の過去バー prepend
}
```

### E.1 内部 state(hook lifetime)

| State | 種類 | 用途 |
|---|---|---|
| `barsByTf` | `useState` | TF 別バー配列 |
| `loadingByTf` | `useState` | TF 別 loading フラグ |
| `requestIdRef` | `useRef` | stale **結果** を捨てるカウンター |
| `abortControllerRef` | `useRef` | in-flight `/chart-stack` HTTP request を中断 |
| `historyLoadingRef` | `useRef` | `loadMoreHistory` の二重発火防止 |
| `historyExhaustedRef` | `useRef` | `loadMoreHistory` の履歴尽き判定 |
| `currentPosRef` | `useRef` | `currentPosition` の安定参照(cache キー用) |

### E.2 不変条件

- `barsByTf[tf]` は **timestamp 昇順** で **重複なし**(`loadMoreHistory` の merge は Map で保証)([invariants.md I-7](./invariants.md#i-7-バー時系列の単調性))
- `requestIdRef` で stale **結果** を検知:銘柄 / TF 集合切替時に `++requestId` し、古い in-flight 結果を `setBarsByTf` 反映前に捨てる
- `abortControllerRef` で stale **HTTP request** を中断:銘柄切替・unmount で前回の controller を `abort()` し、新規 `AbortController` を割り当てて signal を `request<T>` に渡す。同時 in-flight な `/chart-stack` は最大 1 件
- `AbortError` は `catch` 内で silent return(notify せず、state も更新しない。ユーザー操作起因の意図的中断のため)
- 失敗時は `console.warn` で残す(silent failure を作らない、[I-10](./invariants.md#i-10-observability-の最低ライン))。ユーザー入力起因のエラーは `notify` で UI に出す([I-11.4](./invariants.md#i-114-ユーザー入力起因の失敗は-ui-に通知))
- `reloadStack` は cache をバイパスする(advance 直後の `currentPosition` race を回避、§5.1.7)
- cache hit 時は同期完了し HTTP 経路を通らない → abort 機構と独立

### E.3 `chartStackCache` への依存

`chart/chartStackCache.ts` のモジュールスコープ LRU(`(symbol, current_position, tfsKey)` をキー、最大 50 エントリ)を `fetchStack` の冒頭で参照する:

```
useCharts.fetchStack(useCache=true):
  if useCache && (entry = chartStackCache.get(key)):
    setBarsByTf(entry.bars)         # 同期完了、HTTP 経路スキップ
    return
  # cache miss
  abortControllerRef.current?.abort()
  abortControllerRef.current = new AbortController()
  res = await api.chart.stack(sessionId, symbol, { signal })
  setBarsByTf(res.stacks_to_record)
  chartStackCache.set(key, res)
```

`reloadStack(useCache=false)` は cache を読まず・書かずで通す(advance 直後 race 回避)。

---

## §F 主要フロー

### F.1 ページロード

```
SessionPage mount
  ↓ useSessionFetch: api.sessions.get / api.trades.getActive / api.trades.getLatest
  ↓ useCharts: chartStackCache を参照(§5.1.7)
      hit  → 同期で setBarsByTf、HTTP 経路をスキップ
      miss → abortControllerRef.current?.abort() で前回 fetch を中断
              → 新規 AbortController を割当 → api.chart.stack(signal) を発行
              → 全 TF の bars がまとめて返る → setBarsByTf + cache に保存
  ↓ 各 TF の Chart は bars prop を受け取り setData(Chart instance は永続化、§5.1.3)
  ↓ useEconomicEvents: 表示 range が決まったら events を取得 → EventOverlay
  ↓ useDrawings: symbol に紐づく描画を取得 → DrawingOverlay + priceLines
```

銘柄切替も同経路を辿る。連続切替時は **古い銘柄の `/chart-stack` request が AbortController で中断される** ため、backend に到達する request は「現在見ている銘柄の 1 件」だけになり、MT5 IPC の連鎖待機が起きない(§5.1.7)。

### F.2 handleAdvance

```
handleAdvance(n=1):                          # n は entry TF のバー数(仕様 §5.1.1)
  setAdvancing(true)
  m5_bars = n × tfMinutes(focusedTf) / 5     # M5=1 / M15=3 / H1=12 / H4=48 / D1=288 / W1=2016 / MN1≈8640
  res = await api.chart.advance(sessionId, m5_bars, currentSymbol)
  if res.trade_auto_closed:
    setLatestTrade(await api.trades.getLatest)
    setActiveTrade(null)
  setSession(await api.sessions.get)         # current_position 反映
  await reloadStack()                         # cache バイパスで再取得
  setAdvancing(false)
```

体感性能: 全 TF キャッシュが warm なら 100ms 以下。entry TF が D1/W1/MN1 で M5 換算が大きい場合、初回 fetch は MT5 から数百〜数千本取得するため数百 ms 〜秒オーダー(キャッシュ完了後は warm)。

### F.3 SL/TP 配置

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

「BUY/SELL ボタン」は持たない(SL 位置が方向そのものを表すため重複入力になる)。

### F.4 メモ編集

```
M キー or 📝 メモボタン
  → setMemoOpen(true)
MemoPanel:
  銘柄別メモ: noteDraft / memoDraft を debounce 500ms
  → api.sessions.updateNote / updateCandidate
  → onChange callback で setSession
横断メモが空文字以外になると settled_at 自動セット([§4.2.2 参照](../spec/04-session-flow.md))
```

---

## §G API クライアント

`api/client.ts` のグローバル `api` オブジェクト経由でのみ backend を呼ぶ。型は `api/types.ts`。新エンドポイントを追加する時は両ファイルに対応する。

`request<T>(path, init)` で `credentials: 'include'`(認証 cookie)+ JSON ヘッダーを共通設定。`init.signal` で `AbortSignal` を渡せる(`useCharts.abortControllerRef` がこの経路を使う)。

---

## §H 既知の複雑さと落とし穴

### H.1 `chartStackCache.ts` の module-level LRU(§5.1.7)

`(symbol, current_position, tfsKey)` をキーに `/chart-stack` レスポンス全体をクライアント in-memory にキャッシュ。`useCharts` が銘柄切替で再マウントされても生存させたいのでモジュールスコープを選択。最大 50 エントリの簡易 LRU、タブクローズで破棄。`useCharts.fetchStack` の冒頭で参照、ヒット時はネットワーク往復をスキップ。`reloadStack`(advance 直後)経路は cache バイパス(古い `currentPosition` を指したまま fetchStack が走る race を回避)。

**Failure mode**: cache 経由で `current_position` の race が起きると「古い position の bars が新しい session に乗る」。`reloadStack` バイパスを忘れると再現する。advance 直後は必ず `reloadStack()` 経由。

### H.2 `useCharts.abortControllerRef` の AbortController 管理(§5.1.7)

銘柄切替・unmount で進行中の `/chart-stack` HTTP request を `AbortController.abort()` で中断する。連続切替時に backend thread pool に古い銘柄の request が滞留し、MT5 IPC 内部シリアライズで連鎖待機する事態を防ぐ。`requestIdRef`(stale 結果検知)とは役割が補完的(controller は HTTP レベルで止め、reqId は完了結果の state 反映を防ぐ)。cache hit 時は同期完了するため abort 経路を通らない。

**Failure mode**: abort を入れずに reqId だけにすると、HTTP request は backend に到達して MT5 thread pool に滞留する。連続銘柄切替で「途中から極端に遅い / 終わらない」症状が再現する。

### H.3 React 描画と 1 画面統合フローの責務集中

`SessionPage` は phase 切替を 1 コンポーネント内で完結させるため state が集中する。phase 別の責務分割は行わず、「state は hook へアウトソース、JSX 配置だけが SessionPage に残る」原則で複雑さを抑える。新たなフェーズ要素を足す前に「対応する hook がある / 必要か」を先に判定する。

### H.4 残課題(将来の別タスク)

- **Chart.tsx 責務分割**: 現状 616 行 / useEffect 9 個(うちハンドラ ref 6 個)。座標変換 / series 管理 / priceLines / markers / indicators / クロスヘア / スクリーンショットを Chart.tsx 内部の private hook に分解する余地あり。分割方針は [`frontend-chart.md §4.3`](./frontend-chart.md#43-private-hook-分割方針phase-3) を参照
- **`drawing/state.ts` 599 行を tool 別 reducer に分割**: 設計自体は良好(state machine)、ファイルサイズだけが課題。次の描画機能追加時に着手
- **`index.css` 1,274 行のモジュール化**: CSS Modules / Tailwind 移行は別タスク
- **テスト整備(Vitest)**: テスト戦略は [§I](#i-テスト戦略と検証粒度) に集約。実体ファイル整備は別タスク

### H.5 一般的な落とし穴

| 事象 | 原因 | 対処 |
|---|---|---|
| 「足進めても上位 TF が動かない」 | backend cache の古さ | [`backend.md` § F.2](./backend.md#f2-market-data-層) 参照(自動収束する) |
| 「TF 間で価格が違う」 | 同上 | 同上 |
| 「クロスヘアが他チャートで Value is null」 | `setCrosshairPosition` に対象 series に存在しない time を渡している | bars 内の最寄り timestamp を使う(現状実装済) |
| 「advance ボタンが無反応」 | `advancing` が true で stuck、または refreshTails が silent fail | DevTools Console を確認、必要なら hard reload |

---

## §I テスト戦略と検証粒度

frontend のロジックは **3 階層** に分けて検証する。各階層で最低コストの手段を選び、UI 統合検証(Playwright)を最後の通し確認に絞る方針([WORKFLOW.md §C](../WORKFLOW.md#c-検証粒度の使い分け) と整合)。

### I.1 Tier 1: 純関数(vitest が最も ROI 高い)

frontend 側で **I/O も外部状態も持たない関数群**。バグの大半はここで再現可能で、Playwright で座標計算しながら検証するよりも 1 桁速い。

| ファイル | 検証対象 | 行数 | 理由 |
|---|---|---|---|
| `drawing/state.ts` | `dispatchEvent` + 各 reducer (`reduceIdle` / `reduceMovingTradeLine` 等) + selector 群 (`cursorOf` / `tradeLinePreviewOf` 等) | 599 | SL/TP drag、波動 auto-advance、weekend skip、hit-test 競合(SL 優先)等のロジック集中 |
| `drawing/tools/*.tsx` | 各 ToolMetadata の `hitTest` / `getXxxData` 関数、`nextWave`、`isWaveValue` | — | 描画 hit-test の境界条件 |
| `drawing/visibility.ts` | `isDrawingVisibleOnTf` | 13 | TF 可視性の規則 |
| `indicators/calculations.ts` | `calcSMA` / `calcEMA` / `calcRSI` | 70 | インジケーター計算式の正確性 |
| `chart/chartStackCache.ts` | `getCachedStack` / `setCachedStack` の LRU 動作 | 60 | eviction / 再挿入順 / null current_pos の扱い |
| `utils/datetime.ts` | `formatJST` / `formatJSTDate` | 13 | TZ 変換の正確性 |

backend 側でも同様のレイヤ(`_bar_start_for_tf`、`_calculate_pips`、`resample_ohlc` の規約等)が pytest 対象になる。

### I.2 Tier 2: hook / API I/O(curl + 必要に応じて React Testing Library)

**state 管理 + I/O が混ざる層**。テスト戦略:
1. **backend エンドポイント**は `curl` で叩いて直接確認(レスポンス値 / ステータスコード)
2. **frontend hook の動作**は基本的にテスト化しない(curl で backend 確認 → frontend 側のバグなら Tier 1 に切り出して単体検証)
3. 例外として **副作用が重要なロジック**(`useCharts` の cache + abort 整合性など)は React Testing Library での hook test を検討

| 対象 | 推奨手段 | 備考 |
|---|---|---|
| `api/client.ts` の URL 構築 / signal 配線 | 必要時のみ単体抽出 | 現状は inline、テスト化要なら抽出可 |
| `hooks/useCharts.ts` cache / abort | hook test 候補 | requestId / abortController / cache の 3 状態整合性が複雑 |
| `hooks/useDrawings.ts` / `useTradeFlow.ts` / `useSessionFetch.ts` | curl で backend 確認 | 単純な API 叩き + state 反映のみ |
| `hooks/useDrawingInteraction.ts` | Tier 1 に集約済み | propagator のみ(ロジックは `state.ts`) |

### I.3 Tier 3: UI 統合(Playwright を最後の通し確認だけ)

**canvas / SVG / マウス入力 / 全体フロー**。ここでしか検証できないものに限って Playwright を使う:
- canvas / SVG の座標が実描画で正しいか
- ライブラリ(lightweight-charts)の暗黙副作用と統合した結果
- ユーザー視点の主要フロー(エントリー → 保有 → drag SL → advance → 決済)の通し動作

**Playwright を使うときのコツ**(過去経験):
- `priceToY` 等の座標 API を直接叩いて y を取得する(視認推定は誤差が出る)
- focus TF を明示的にクリックで確定してから操作する
- drag は `page.mouse.move` を 5 px 刻みで段階発火
- カーソル変化(`ns-resize` 等)で hit-test 成功を検知する
- backend 状態は curl で別途確認(UI と API の両方を検証)

### I.4 過去事例の階層分類

| 機能 | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| ver 1.78 chart-stack 最新 N バー保証 | — | curl で各 TF の bars 数確認 | (任意) |
| ver 1.79 advance 境界アライメント | `_bar_start_for_tf` 単体 | curl で current_position 遷移確認 | (任意) |
| ver 1.80 SL/TP drag | `findTradeLineHit` / `reduceMovingTradeLine` 単体 | curl で `PATCH /trade` 確認 | drag → mouseup → priceLine 再描画の通し |
| ver 1.77 波動 auto-advance | `nextWave` / `reduceDrawingWaveLabel` 単体 | — | キーホットキー統合 |
| ver 1.76 LowerTfRangeOverlay | `logicalToTime` / `timeToLogical` 単体 | — | px 計算と SVG 配置 |

**新機能 / バグ修正の着手前に**、上表を参考にして「どの Tier で検証できるか」を 30 秒で判定してから作業に入る。詰まり始めたら 1 段下に戻って原因を狭める。
