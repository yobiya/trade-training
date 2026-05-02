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
│  └─ SessionPage.tsx         ← 主要(現状 600+ LOC)
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
│  ├─ useNotify.ts             ← toast 通知
│  └─ useAuth.ts
├─ chart/                     ← Chart 関連の純粋ロジック(モジュールスコープ)
│  └─ chartStackCache.ts      ← /chart-stack レスポンス LRU(詳細は §H)
├─ api/
│  ├─ types.ts                 ← レスポンス・リクエスト型
│  └─ client.ts                ← fetch ラッパ + エンドポイント定義
├─ contexts/
│  └─ NotifyContext.tsx        ← toast 通知 Provider
├─ drawing/                    ← drawing-tools.md
│  ├─ types.ts, state.ts, tools/, visibility.ts
├─ indicators/                 ← インジケーター(SMA / EMA / RSI 等)
└─ utils/
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

- **Chart.tsx 責務分割**: 460+ 行 / useEffect 8 個。座標変換 / series 管理 / イベント中継 / クロスヘア / スクリーンショットを内部 private hook に分解する余地あり。詳細は [`frontend-chart.md`](./frontend-chart.md)
- **`drawing/state.ts` 515 行を tool 別 reducer に分割**: 設計自体は良好(state machine)、ファイルサイズだけが課題。次の描画機能追加時に着手
- **`index.css` 1,274 行のモジュール化**: CSS Modules / Tailwind 移行は別タスク
- **テスト導入(Vitest / Pytest)**: Phase D として別タスク

### H.5 一般的な落とし穴

| 事象 | 原因 | 対処 |
|---|---|---|
| 「足進めても上位 TF が動かない」 | backend cache の古さ | [`backend.md` § F.2](./backend.md#f2-market-data-層) 参照(自動収束する) |
| 「TF 間で価格が違う」 | 同上 | 同上 |
| 「クロスヘアが他チャートで Value is null」 | `setCrosshairPosition` に対象 series に存在しない time を渡している | bars 内の最寄り timestamp を使う(現状実装済) |
| 「advance ボタンが無反応」 | `advancing` が true で stuck、または refreshTails が silent fail | DevTools Console を確認、必要なら hard reload |
