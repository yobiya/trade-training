# frontend chart

← [設計トップ](../ARCHITECTURE.md) | [横断不変条件](./invariants.md) | [frontend overview](./frontend-overview.md) | [描画システム](./drawing-tools.md)

---

`apps/trade-trainer/frontend/src/components/Chart.tsx` を中心とした **チャート描画・座標変換・lightweight-charts (以下 LWC) との境界・複数 TF 間 projection・overlay 群** をまとめて扱う。

このファイルは **LowerTfRangeOverlay の連続実装失敗を踏まえて切り出された** 専用設計書。Chart 関連の機能を新規追加・修正する前に必ず通読する。

## 目次

- [§1 Chart コンポーネントの責務と契約](#1-chart-コンポーネントの責務と契約)
- [§2 座標系と TF 間 projection の規約](#2-座標系と-tf-間-projection-の規約)
- [§3 lightweight-charts 境界カタログ](#3-lightweight-charts-境界カタログ)
- [§4 Chart instance の lifecycle と useEffect 責務](#4-chart-instance-の-lifecycle-と-useeffect-責務)
  - [§4.3 private hook 分割方針(Phase 3)](#43-private-hook-分割方針phase-3)
- [§5 オーバーレイ群](#5-オーバーレイ群)
- [§6 関連 hooks(useChartRefCache / useCrosshairSync)](#6-関連-hooksusechartrefcache--usecrosshairsync)
- [§7 アンチパターン記録(過去の失敗から)](#7-アンチパターン記録過去の失敗から)

---

## §1 Chart コンポーネントの責務と契約

### 1.1 責務

`<Chart>` 1 つは「単一 TF・単一 symbol のローソク足チャートを描画する pane」を担当する。

- 内部に LWC の `IChartApi` / `ISeriesApi<'Candlestick'>` を 1 つずつ保持
- props 経由で bars / priceLines / markers / indicators を受け取り setData / 反映
- `forwardRef` + `useImperativeHandle` で **命令的 API** (`ChartHandle`) を外部に公開
- ユーザー操作(マウス / クロスヘア / クリック)を props のコールバックで上位へ中継

`<Chart>` は **描画ツール固有のロジックを持たない**。描画 / 経済指標 / 下位 TF 帯の表示は **overlay コンポーネント** が `ChartHandle` 経由で計算してレンダリングする([§5](#5-オーバーレイ群))。

### 1.2 props

```ts
type Props = {
  bars: OhlcBar[]                                 // setData の入力。同 symbol 内では visible range を維持する
  timeframe: string                                // TF キー(M5..MN1)。Chart instance ごとに固定
  symbol: string                                   // 銘柄。変化時に bars 差し替え + width preserve(§4)
  cursor?: string                                  // CSS cursor(描画ツール選択中の表示)
  digits?: number                                  // 価格精度(MT5 symbol_info.digits)
  onNeedMoreHistory?: (earliestUnix) => void       // 左端到達で loadMoreHistory を要求
  onChartClick?: (price, time, px) => void
  onMouseMove?: (price, time, px) => void
  onMouseDown?: (price, time, px) => void
  onMouseUp?: (price, time, px) => void
  priceLines?: PriceLine[]                         // 横線(描画 / SL/TP / Entry / Exit)
  markers?: ChartMarker[]                          // §5.5.4 entry_tf チャートのみ
  indicators?: IndicatorConfig[]
}
```

### 1.3 `ChartHandle` 契約

`ref` 経由で外部に公開する命令的 API。**呼び出し可能性 / 副作用 / null 返却条件 / 呼び出し制約** を以下にまとめる。

| メンバ | 型 | 副作用 | null / 失敗返却 | 呼び出し制約 |
|---|---|---|---|---|
| `api` | `ChartApi`(座標変換 + setScrollEnabled) | なし(座標変換) / `setScrollEnabled` のみオプション変更 | 各メソッドは **マウント前 / unmount 後** で `null` 返却の可能性あり。詳細は §1.4 | いつでも呼べる |
| `containerEl` | `HTMLDivElement \| null` | なし | unmount 時 `null` | DOM 直接アクセスは推奨しない |
| `subscribeRedraw(cb)` | `(cb) => () => void` | 内部購読リストに `cb` を追加 | 未マウント時は no-op unsubscribe を返す | useEffect 内で呼び、cleanup で必ず unsubscribe |
| `setCrosshairTime(time \| null)` | `(t) => void` | LWC `setCrosshairPosition` を呼ぶ | bars に該当時刻が無いと最寄りバーへスナップ。例外は捕捉してクラッシュさせない | クロスヘア同期(§6) |
| `subscribeUserCrosshair(cb)` | `(cb) => () => void` | 内部 subscriber set に追加 | — | **ユーザー操作のみ** 通知される(programmatic move は含めない、§6.2) |
| `getVisibleLogicalRange()` | `() => { from, to } \| null` | なし | 未マウント時 `null` | 浮動小数の logical range をそのまま返す。`from <= 0` で過去側の whitespace、`to >= bars.length-1` で右側 rightOffset whitespace に到達している判定([I-12](./invariants.md#i-12-座標変換と-tf-間-projection)) |

#### 1.4 `ChartApi` の各座標変換メソッド

ChartApi は ref 経由・onChartClick の引数経由で取得できる「**当該 Chart 内** の座標変換 API」。**TF をまたぐ用途には使えない**(§2 で別経路を定義)。

| メソッド | 戻り値 | 線形外挿 | null 返却条件 | 説明 |
|---|---|---|---|---|
| `priceToY(price)` | `number \| null` | あり(LWC `priceToCoordinate` がレンジ外でも線形外挿で返す) | series 未初期化時 | 価格 → y 座標 |
| `yToPrice(y)` | `number \| null` | あり | 同上 | y 座標 → 価格 |
| `timeToX(time)` | `number \| null` | **frontend 側で外挿/補間あり**(範囲外は `tfSec` 換算 logical で外挿、in-range gap は隣接バーの時間比で proportional 補間) | bars 空のみ。**in-range gap でも null を返さない**(weekend / 祝日 gap を跨ぐ trendline drag 等で描画消失するバグの再発防止) | 時刻 → x 座標 |
| `xToTime(x)` | `number \| null` | あり(範囲外は `tfSec` で外挿) | bars 空 / `coordinateToLogical` が null | x 座標 → 時刻 |
| `logicalToX(logical)` | `number \| null` | **あり**(LWC `logicalToCoordinate` は範囲外 logical でも線形外挿で返す) | 未マウント時のみ | logical → x 座標。**LowerTfRangeOverlay の唯一の px 変換 API** |
| `setScrollEnabled(enabled)` | `void` | — | — | チャートのドラッグパン有効/無効。Moving 状態で false にして描画と干渉させない |

**重要**: `timeToX` の挙動は frontend ラッパで一部補完されているが、**TF をまたぐ projection には使ってはいけない**([I-12.2](./invariants.md#i-122-tf-間-projection-は純粋関数経由のみ))。理由は §3 で詳述する。

---

## §2 座標系と TF 間 projection の規約

LowerTfRangeOverlay 連続失敗の直接原因はこの規約が暗黙的だったこと。明文化することで再発を防ぐ。

### 2.1 3 つの座標系

各 Chart pane には 3 つの座標系がある:

- **logical**(浮動小数 index): バー配列のインデックス相当。`getVisibleLogicalRange()` が `{from, to}` を返す。`from < 0` は過去側 whitespace、`to > bars.length - 1` は右側 rightOffset whitespace を表す
- **time**(Unix 秒、UTC): バーの開始時刻。`bars[i].t`
- **pixel**(pane 内の x 座標): SVG / canvas 描画用。`logicalToCoordinate(logical) → number`

3 者の関係:

```
time = bars[Math.floor(logical)].t + (logical - Math.floor(logical)) * tfSec   (in-range)
logical = bisect(bars, time) + (time - bars[lo].t) / tfSec                        (in-range)
pixel = logicalToCoordinate(logical)                                                (LWC API、外挿あり)
```

`tfSec` は当該 TF の 1 バーの秒数(`TIMEFRAME_MINUTES[tf] * 60`)。

### 2.2 単一 Chart 内の座標変換

同一 Chart instance の中で `time ↔ logical ↔ pixel` を変換するときは、**LWC の API を素直に使う**:

| 用途 | API |
|---|---|
| price ↔ y | `priceToY` / `yToPrice`(`series.priceToCoordinate` ラッパ) |
| time → x | `timeToX`(`timeScale.timeToCoordinate` + 範囲外フォールバック) |
| x → time | `xToTime`(`timeScale.coordinateToTime` + 範囲外フォールバック) |
| logical → x | `logicalToX`(`timeScale.logicalToCoordinate` の薄ラッパ、外挿あり) |

ライブラリ内の挙動詳細は [§3](#3-lightweight-charts-境界カタログ) のカタログ参照。

### 2.3 TF 間 projection の標準経路(必須)

「下位 TF の visible range を上位 TF pane に重ねる」のように **複数 Chart instance をまたぐ** 座標変換では、ライブラリの `timeToCoordinate` を使わない。代わりに次の純粋関数経路を使う:

```
lower の visible logical
  → (lowerBars + lowerTfSec の線形補間 = logicalToTime) → 時刻(Unix 秒)
  → (upperBars + upperTfSec の線形補間 = timeToLogical) → upper の logical
  → upper.api.logicalToX(upperLogical) → pixel x
```

具体的なコード形(参考、`LowerTfRangeOverlay.tsx` 実装):

```ts
function logicalToTime(logical: number, bars: OhlcBar[], tfSec: number): number {
  const last = bars.length - 1
  if (logical >= last) return bars[last].t + (logical - last) * tfSec
  if (logical <= 0)    return bars[0].t + logical * tfSec
  const lo = Math.floor(logical)
  return bars[lo].t + (logical - lo) * tfSec
}

function timeToLogical(time: number, bars: OhlcBar[], tfSec: number): number {
  const last = bars.length - 1
  if (time >= bars[last].t) return last + (time - bars[last].t) / tfSec
  if (time <= bars[0].t)    return (time - bars[0].t) / tfSec
  // 二分探索で bars[lo].t <= time < bars[lo+1].t を満たす lo を求める
  let lo = 0, hi = last
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid].t <= time) lo = mid; else hi = mid - 1
  }
  return lo + (time - bars[lo].t) / tfSec
}
```

両関数は **純粋関数**(同じ入力に対して常に同じ出力 / 副作用なし)。LWC の内部状態に依存しない。

### 2.4 なぜ `timeToCoordinate` を使わないか

LWC の `timeToCoordinate(time)` は **time が当該 chart の visible bars の bar 境界に一致しないと null を返す**。下位 TF の logical 値は浮動小数(例: 53.0、53.67)で、それを時刻に変換すると **上位 TF のバー境界に乗らない時刻**(M15 のバー時刻が H4 のバー境界に乗ることはほぼない)が生まれる。

frontend 側の `timeToX` は範囲外の time に対して logical 換算で外挿し、**in-range gap**(時刻が `bars[lo]` と `bars[lo+1]` の間 = weekend / 祝日 gap や mid-bar 時刻)に対しても隣接バーの時間比で **proportional 補間** で logical を返す(§2.2 純粋関数経路と同規則)。これにより単一 Chart 内で時刻に閉じた drag(trendline body を週末を跨いで移動する等)で gap-time が新 point になっても描画が消失しない。

ただし TF 間 projection で `timeToX` を使うと **下位 TF の bar 配列 / tfSec を上位 TF chart の `timeToX` へ渡す形になり矛盾する**(timeToX は自 chart の barsRef を参照する)。TF 間は §2.2 の純粋関数経路を必ず使う。

純粋関数経路は **bar 境界に乗らない時刻でも線形補間** で logical を返すため、こうした分岐がそもそも発生しない。LWC 依存は `logicalToCoordinate` だけになり、それは範囲外 logical でも線形外挿で px を返すため、唯一の信頼できる px 変換 API として使う([I-12.2](./invariants.md#i-122-tf-間-projection-は純粋関数経由のみ))。

### 2.5 両端 snap 規則(rightOffset 不一致への対処)

TF 間 projection で発生する唯一の補正が「両 pane が共に末端を表示しているとき帯端を upper の visible 端に snap する」。理由は **lower / upper の rightOffset(各 4 バー)は同じ視覚オフセットだが時間幅が違う**(M15 → H4 なら 60 min vs 960 min)ため、純粋経路だと「両 TF が最新を見ている」ときに帯右端が upper pane の右端まで届かないことがある。

snap 条件は **AND**:

```
const lowerLast = lowerBars.length - 1
const upperLast = upperBars.length - 1

// lowerRange.to >= lowerLast かつ upperRange.to >= upperLast のとき右端を snap
if (lowerRange.to >= lowerLast && upperRange.to >= upperLast) {
  rightLogical = upperRange.to
}
// lowerRange.from <= 0 かつ upperRange.from <= 0 のとき左端を snap
if (lowerRange.from <= 0 && upperRange.from <= 0) {
  leftLogical = upperRange.from
}
```

OR 条件にしてはいけない(「lower だけ末端 / upper は途中」のような片側満たしのケースで帯位置が誤差で揺らぐ。snap は補正であって、適用過剰は害)。

### 2.6 broker history 不一致への対処

ブローカーのヒストリ制限で、上位 TF のバーが少なく下位 TF の時刻範囲が上位 TF のデータ範囲を超えるケース(W1 / MN1 で頻発)では、`timeToLogical(time, upperBars, upperTfSec)` が **負値 or `lastIdx` 超過** を返す。

この場合、**`logicalToCoordinate` の線形外挿に任せる**。クランプや「null だから諦める」処理を入れない。`logicalToCoordinate` は範囲外でも px を返してくれるので、SVG `<rect>` に渡したうえで pane の clip に任せれば帯が pane 端で切れた形で正しく見える([I-12.3](./invariants.md#i-123-範囲外-logical-はクランプしない))。

ただし [§3.7](#37-logicaltocoordinate-は-fractional-引数を受け付けない) のとおり LWC の `logicalToCoordinate` は **fractional 引数を受け付けず 0 を返す不具合** があるため、本 overlay は `floor(logical)` と `floor(logical) + 1` の整数 2 点で px を取り線形補間する `logicalToXFractional` ラッパで吸収する。範囲外の整数は LWC が線形外挿で返すため、ラッパも整数化するだけで動く。

---

## §3 lightweight-charts 境界カタログ

LWC の暗黙挙動 / 副作用 / null 返却条件を 1 箇所に集約する。Chart 周りの新機能を作る前にここを参照する。

### 3.1 座標変換 API

| API | 引数 | 戻り値 / null 返却 | 線形外挿 | 注意 |
|---|---|---|---|---|
| `series.priceToCoordinate(price)` | 価格 | `number`(範囲外でも返す) | あり | series 未マウント時のみ null |
| `series.coordinateToPrice(y)` | y | `number \| null` | あり | series 未マウント / 数値外 |
| `timeScale.timeToCoordinate(time)` | Time | `number \| null` | **なし**(in-range の bar 境界外で null を返す) | TF 間 projection で使ってはいけない |
| `timeScale.coordinateToTime(x)` | x | `Time \| null` | **なし** | 範囲外 x で null |
| `timeScale.logicalToCoordinate(logical)` | Logical | `number \| null` | **あり(整数のみ)** | 範囲外 logical でも px を返す。TF 間 projection はこちらに依存する。**注意**: **fractional 引数を受け付けず 0 を返す不具合あり**(整数は正しく動く)→ §3.7 参照 |
| `timeScale.coordinateToLogical(x)` | x | `Logical \| null` | あり | 範囲外でも logical(浮動小数)を返す |

### 3.2 visible range API

| API | 戻り値 | 注意 |
|---|---|---|
| `timeScale.getVisibleLogicalRange()` | `{from, to} \| null`(浮動小数) | 浮動小数。`from <= 0` で過去 whitespace、`to >= bars.length-1` で右側 rightOffset whitespace |
| `timeScale.setVisibleLogicalRange({from, to})` | `void` | 明示書き換え |
| `timeScale.subscribeVisibleLogicalRangeChange(cb)` | `void` | **暗黙の自動 emit あり**(§3.3) |

### 3.3 setData の暗黙副作用

`series.setData(bars)` は以下を引き起こす:

1. **visible range の維持**(同一 series instance なら setData 後も visible logical range は保持される)
2. ただし、**自動 emit**: setData 直後に `subscribeVisibleLogicalRangeChange` のハンドラが「ライブラリが内部的に再計算した範囲」を 1 回 emit することがある。ユーザー操作と区別がつかないため、ハンドラ内で memory に書き戻すような処理は破綻の温床になる(§7.1 参照)
3. マーカー (`setMarkers`) は setData で消えない(別管理)
4. priceLines は setData で消えない(別管理、明示削除で消える)

### 3.4 クロスヘア API

| API | 用途 | sourceEvent |
|---|---|---|
| `chart.subscribeCrosshairMove(cb)` | クロスヘア移動を購読 | `param.sourceEvent` が `undefined` = programmatic(setCrosshairPosition 由来)、それ以外 = ユーザー操作 |
| `chart.setCrosshairPosition(price, time, series)` | 命令的にクロスヘアを置く | sourceEvent = undefined で emit される |
| `chart.clearCrosshairPosition()` | クリア | 同上 |

`subscribeUserCrosshair`(`ChartHandle`)は `param.sourceEvent !== undefined` フィルタを通すことで **ユーザー操作のみ** subscriber に流す。programmatic な move は通知しないため、複数 Chart 間でクロスヘアを同期しても feedback ループが構造的に発生しない(§6.2)。

### 3.5 rightOffset の挙動

`createChart({ timeScale: { rightOffset: 4 } })` で右端に 4 バー分の whitespace が追加される。

- **whitespace は時間幅 = 4 × tfSec**(TF ごとに違う)
- M5 = 1200 秒、M15 = 3600 秒、H1 = 14400 秒、H4 = 57600 秒、D1 = 345600 秒、W1 = 2419200 秒、MN1 ≈ 10368000 秒
- ⇒ TF が違う pane を縦積みすると **同じ視覚オフセット 4 バー分でも時間幅が大きく違う**。これが [§2.5](#25-両端-snap-規則rightoffset-不一致への対処) snap が必要な根本原因

### 3.6 バー時刻の単調性要件

`series.setData(bars)` の bars は時刻昇順・重複なし([I-7](./invariants.md#i-7-バー時系列の単調性))。違反すると LWC が internal assertion で例外を投げる場合がある。`useCharts.mergeBarsTail` 等で違反を検証する。

### 3.7 `logicalToCoordinate` は fractional 引数を受け付けない

LWC の `timeScale.logicalToCoordinate(logical)` は **logical が整数の場合のみ正しい px を返し、fractional(小数値)を渡すと 0 を返す**(整数なら範囲外でも線形外挿で px を返すのに対し、fractional は in-range でも 0 にフォールバックされる)。

実測例(D1 pane visible logical [53, 203]、200 バー、pane 幅 ~932 px):

| logical | 戻り値 | 期待値(線形補間) |
|---|---|---|
| 53 | 2.10 | ~0 ✓ |
| 100 | 293.44 | 292 ✓ |
| 175 | 758.34 | 758 ✓ |
| **175.5** | **0** ❌ | 761 |
| 176 | 764.54 | 764 ✓ |
| 203 | 931.90 | 932 ✓ |

**過去事故**: LowerTfRangeOverlay の TF 間 projection は時刻補間で fractional logical(例: H4→D1 で `projFrom = 175.5`)を生むため、これを直接 `logicalToCoordinate` に渡すと x1 = 0(pane 左端)が返り帯が pane 全幅を覆う症状になっていた(H4+ 以上で発症)。

**対処**: `logicalToCoordinate(integer)` のみを使う方針とし、fractional は **`floor(logical)` と `floor(logical) + 1` の整数 2 点で px を取って線形補間する自前ラッパ**で吸収する。`LowerTfRangeOverlay.tsx:logicalToXFractional` がこの責務を持つ:

```ts
function logicalToXFractional(handle, logical) {
  const lo = Math.floor(logical)
  const frac = logical - lo
  const xLo = handle.api.logicalToX(lo)
  if (xLo === null) return null
  if (frac === 0) return xLo
  const xHi = handle.api.logicalToX(lo + 1)
  if (xHi === null) return null
  return xLo + frac * (xHi - xLo)
}
```

`api.logicalToX` 自体は LWC の薄ラッパなので **共通ラッパは ChartHandle 側に持たせず、利用側(LowerTfRangeOverlay)が必要に応じて整数化する** 方針。

ただし `chartApi.timeToX` は内部で fractional logical を生み出す経路があるため(in-range gap の時刻 → 隣接バー時間比補間で fractional logical を返す。trendline / fibonacci を別 TF chart に重ね描きする場合に発生)、`useChartCoordinates.timeToPx` 内に **`logicalToCoordinateFractional` ヘルパを持ち、内部で同じ整数 2 点補間を実施**する。これにより `timeToX` の利用側(各ツールの `renderOverlay`)は fractional を意識せずに px を取れる。

---

## §4 Chart instance の lifecycle と useEffect 責務

### 4.1 useEffect の役割表

| useEffect | 責務 | 依存配列 |
|---|---|---|
| ハンドラ ref 更新(複数) | onChartClick / onMouseMove 等を ref に最新値を入れる | 各ハンドラ |
| メイン初期化 | `createChart` / `addCandlestickSeries` / 各種購読 / cleanup | `[]`(マウント時のみ) |
| クロスヘア同期 | `setCrosshairTime` から呼ばれて近接バー検索 → setCrosshairPosition(命令的、useEffect 不要) | — |
| **描画**(bars / symbol 反映) | `series.setData(bars)`。初回(timeframe 初登場)は `applyVisibleRange(width=DEFAULT_VISIBLE_BARS)` で右端揃え。`symbol` prop が変わった時は **直前の visible range の width を取得** → setData → 新 bars の右端に揃えて再 set。同 symbol 内の bars 変化(advance / loadMoreHistory)は visible range を触らない | `[bars, timeframe, symbol]` |
| 価格精度 | `priceFormat.precision` を `digits` に追従 | `[digits]` |
| priceLines 差分更新 | 削除→追加で priceLines を反映 | `[priceLines]` |
| markers 反映 | `setMarkers([])` でクリア + 一括上書き | `[markers]` |
| インジケーター差分更新 | 種別ごとに addLineSeries / removeSeries / setData | `[indicators, bars]` |

### 4.2 Chart instance 永続化の不変条件

**Chart instance は TF ごとに 1 つだけ永続化** する。SessionPage 側の key は `<Chart key={tf}>`(symbol を含めない)。銘柄切替は `symbol` prop の変化として扱い、Chart 内部で setData + width preserve のロジックを走らせる。

不変条件:

- **Chart instance の生存中、visible range は明示的に書き換えた時だけ変わる**(`setVisibleLogicalRange` を呼ぶのは「初回 mount」と「symbol 変化時」のみ)
- **`subscribeVisibleLogicalRangeChange` のハンドラは `loadMoreHistory` のトリガーにだけ使う**(何かの memory に書き戻したりしない、§7.1 アンチパターン参照)
- **symbol 変化時** は「直前の visible range の `to - from` を取得 → setData → 新 bars の右端に揃えて `setVisibleLogicalRange`」で width を保持する。bars が width 未満の TF は `fitContent()` フォールバック
- **同 symbol 内の bars 変化**(advance / loadMoreHistory)では visible range を触らない([§3.3 setData の暗黙副作用](#33-setdata-の暗黙副作用) 参照)

トレードオフ: bars が大きく形状の違う symbol へ切り替えた時、width だけ保持するため「直前と同じ位置にいたバー」は表示されない可能性がある(右端は新 bars の最終バーに揃うため)。これは仕様として受け入れる。

ハンドラは ref 経由で常に最新値を呼ぶ(マウント時の購読関数は閉包なので)。

### 4.3 private hook 分割方針(Phase 3)

`Chart.tsx` は §4.1 の通り 9 個の useEffect に責務が分かれているが、ファイル単体で 600+ 行になっておりファイル内ナビゲーションが負担になる。**ロジック・公開 API・lifecycle は据え置きのまま** Chart.tsx 内部に閉じた private hook(同 `components/Chart/` 直下に分割)へ機能単位で切り出す。

#### 不変条件(分割しても破ってはいけない)

- **Chart instance は TF ごとに 1 つだけ永続化**(§4.2)。分割で複数 useEffect の発火順序が変わってはいけない
- **`subscribeVisibleLogicalRangeChange` は `loadMoreHistory` トリガーにのみ使う**(§7.1)
- **公開 props と `ChartHandle` 契約は変えない**(SessionPage / overlay 群との境界を固定)
- **DEV 用 `window.__chartTest` の登録 / unmount cleanup は維持**(e2e テストの依存)

#### 分割候補(機能単位、命名暫定)

| 切り出し先 | 取り込む責務 | 元の useEffect | 公開する API |
|---|---|---|---|
| `useChartInstance` | `createChart` / `addCandlestickSeries` / cleanup / DEV `__chartTest` 登録 | メイン初期化(`[]` deps) | `chartRef`, `seriesRef`, `containerRef` |
| `useChartCoordinates` | `pxToTime` / `timeToPx` の純粋ロジック(barsRef + tfRef を入力) | (関数定義のみ、effect なし) | `pxToTime`, `timeToPx` |
| `useChartCandlestickData` | `series.setData` + 初回 `applyVisibleRange` + symbol 変化時の width preserve | 描画(`[bars, timeframe, symbol]`) | (副作用のみ、戻り値なし) |
| `useChartPriceLines` | priceLines の差分追加 / 削除 / `applyOptions` | priceLines(`[priceLines]`) | (副作用のみ) |
| `useChartMarkers` | `setMarkers` の bulk reset | markers(`[markers]`) | (副作用のみ) |
| `useChartIndicators` | overlay / subpanel 系列の差分追加 + `priceScale` margin 構成 | インジケーター(`[indicators, bars]`) | (副作用のみ) |
| `useChartCrosshair` | `subscribeCrosshairMove` / `setCrosshairPosition` / userCrosshairSubs | (現状はメイン初期化に同居) | `setCrosshairTime`, `subscribeUserCrosshair` |
| `useChartMouseRelay` | container の mousemove / mousedown / mouseup / click / wheel(Ctrl ズーム) を上位 props へ中継 | (現状はメイン初期化に同居) | (副作用のみ、ref で props を読む) |

`useChartScreenshot` は単独 hook 化するほどでもないため `useChartInstance` から chart instance を取って `ChartHandle.takeScreenshot` をビルドするときにインライン定義する。

#### Chart.tsx 本体の到達目標

```ts
export const Chart = forwardRef<ChartHandle, Props>(function Chart(props, ref) {
  const { containerRef, chartRef, seriesRef } = useChartInstance(props.timeframe)
  const { pxToTime, timeToPx } = useChartCoordinates(chartRef, seriesRef, props.timeframe)
  useChartCandlestickData(chartRef, seriesRef, props.bars, props.timeframe, props.symbol)
  useChartPriceLines(seriesRef, props.priceLines)
  useChartMarkers(seriesRef, props.markers)
  useChartIndicators(chartRef, props.indicators, props.bars)
  const { setCrosshairTime, subscribeUserCrosshair } = useChartCrosshair(chartRef, seriesRef)
  useChartMouseRelay(containerRef, chartRef, seriesRef, { onChartClick, onMouseMove, ... })
  // priceFormat (digits) のみ薄い useEffect で残す
  useChartPriceFormat(seriesRef, props.digits)
  // ChartHandle の組み立て
  useImperativeHandle(ref, () => ({ ... }), [])
  return <div ref={containerRef} style={...} />
})
```

到達目標: Chart.tsx 本体 ~200 行。各 private hook は 30〜80 行。

#### 進める前のチェック(WORKFLOW §A-2.1)

Phase 3 着手時、必ず以下を確認してから書き始める:

- [ ] 各 hook が触る ref / state を全部書き出した(`barsRef`, `tfRef`, `prevSymbolRef`, `fittedForTfRef`, `priceLineHandlesRef`, `indicatorSeriesRef`, `rsiPaneConfiguredRef`, `userCrosshairSubsRef`, `onXxxRef` 群)
- [ ] hook 間で ref を共有する場合、所有者(初期化責任)を 1 つに固定したか
- [ ] useEffect の発火順序が分割前と一致するか(初期化 → setData → priceLines → markers → indicators の順は維持)
- [ ] DEV `__chartTest` の Map 登録 / 削除タイミングが Chart instance lifecycle と一致するか(過去の e2e helper 仕様 `tests/e2e/helpers/chart.ts`)
- [ ] `setData` の自動 emit がハンドラ側で memory 書き戻しを起こさないか(§7.1 アンチパターンの再発防止)

---

## §5 オーバーレイ群

各 TF pane では `<Chart>` の上に複数の SVG オーバーレイが重なる。zIndex 規約:

| 層 | コンポーネント | zIndex | pointerEvents | 役割 |
|---|---|---|---|---|
| 1 | `LowerTfRangeOverlay` | 1 | none | 直下 TF レンジ帯 |
| 2 | (ローソク本体) | — | — | LWC canvas |
| 4 | `EventOverlay` | 4 | none(hover 用に部分有効) | 経済指標 縦線 + シェーディング |
| 5 | `DrawingOverlay` | 5 | conditional | 描画(線・トレンド・フィボ) |

帯は**ローソクより下**、描画は**最上層**になるよう zIndex を固定する。

### 5.1 `EventOverlay`

経済指標の縦線・シェーディング。`chartHandle.subscribeRedraw(cb)` を購読し、pan/zoom/resize で再計算。`chartHandle.api.timeToX` を使う(単一 Chart 内の変換なので OK)。

### 5.2 `DrawingOverlay`

描画(水平線・トレンドライン・フィボ・波動ラベル)。詳細は [`drawing-tools.md`](./drawing-tools.md)。

`chartHandle.api.timeToX / priceToY` を使って座標を計算。SVG にレンダリング。hover 判定は drawing tool の `hitTest` に委譲。

### 5.3 `LowerTfRangeOverlay`(§5.1.6)

各 TF pane に「`visibleTfs` 上で 1 つ下に並ぶ TF」の表示時間レンジを半透明縦帯で重ねる。

#### 5.3.1 入力

```ts
type Props = {
  upperHandle: ChartHandle | null
  upperBars: OhlcBar[]
  upperTfSec: number             // = TIMEFRAME_MINUTES[upperTf] * 60
  lowerHandle: ChartHandle | null
  lowerBars: OhlcBar[]
  lowerTfSec: number
  lowerTf: string                 // 帯色決定用(getTimeframeColor)
}
```

bar 配列を SessionPage 経由で受け取り、Overlay 内で純粋関数として変換する設計。Chart 側に余計な API(`getVisibleTimeRange` 等)を持たせない。

#### 5.3.2 アルゴリズム

```ts
useEffect: upperHandle.subscribeRedraw + lowerHandle.subscribeRedraw を購読 → bump tick で再描画

render:
  lowerRange = lowerHandle.getVisibleLogicalRange()   // {from, to}
  upperRange = upperHandle.getVisibleLogicalRange()   // {from, to}
  if !lowerRange || !upperRange || empty bars: return null

  tFrom = logicalToTime(lowerRange.from, lowerBars, lowerTfSec)
  tTo   = logicalToTime(lowerRange.to,   lowerBars, lowerTfSec)

  projFrom = timeToLogical(tFrom, upperBars, upperTfSec)
  projTo   = timeToLogical(tTo,   upperBars, upperTfSec)

  // §2.5 両端 AND snap
  if lowerRange.to >= lowerLast && upperRange.to >= upperLast:
    projTo = upperRange.to
  if lowerRange.from <= 0 && upperRange.from <= 0:
    projFrom = upperRange.from

  x1 = upperHandle.api.logicalToX(projFrom)
  x2 = upperHandle.api.logicalToX(projTo)
  if x1 == null || x2 == null: return null

  left  = min(x1, x2)
  width = abs(x2 - x1)
  if width <= 0: return null

  return <svg><rect x={left} y={0} width={width} height="100%" fill={color} fillOpacity={0.08}/></svg>
```

#### 5.3.3 マウント制御

SessionPage の `visibleTfs.map((tf, i) => ...)` 内で `lowerTf = i > 0 ? visibleTfs[i-1] : null` を導出し、`lowerTf` が `null` の pane(表示中 TF 集合の最下位)では Overlay を mount しない(直下 TF が存在しないため)。

#### 5.3.4 設計上の要点

- LWC への依存は `getVisibleLogicalRange` と `logicalToCoordinate` の **2 つだけ**
- `timeToCoordinate` は使わない(§2.4 / [I-12.2](./invariants.md#i-122-tf-間-projection-は純粋関数経由のみ))
- snap は両端の **AND** 条件のみ(§2.5)
- broker history 不一致は外挿任せ(§2.6 / [I-12.3](./invariants.md#i-123-範囲外-logical-はクランプしない))

---

## §6 関連 hooks(useChartRefCache / useCrosshairSync)

### 6.1 `useChartRefCache`

```ts
useChartRefCache(): {
  handles: Map<string, ChartHandle>      // TF ごとの最新 handle
  setRef: (tf: string) => RefCallback   // <Chart ref={setRef(tf)} /> に渡す
}
```

責務: 各 `<Chart>` の ref を TF キーで安定保持する。`<Chart>` の ref は callback で受けるが、毎レンダーで新 callback を生成すると Chart が detach/attach を繰り返してしまう。`setRef(tf)` は同 TF に対しては **同じ callback 参照を返す**(useRef + Map で安定化)。

各 overlay コンポーネントは `chartHandles.get(tf)` で必要な handle を取り出して購読する。

### 6.2 `useCrosshairSync`

```ts
useCrosshairSync(handles: Map<string, ChartHandle>): void
```

責務: 各 chart の `subscribeUserCrosshair` でユーザー操作時刻を購読し、他 chart の `setCrosshairTime` を呼ぶ。programmatic な move は通知されない仕組み(§3.4)により feedback ループは構造的に発生しない。

```
Chart A でユーザーがクロスヘアを動かす
  → subscribeUserCrosshair の cb 発火(sourceEvent あり)
  → hook が他の Chart B / C に setCrosshairTime(time) を呼ぶ
  → 各 Chart は setCrosshairPosition を実行(sourceEvent = undefined)
  → Chart 内 subscribeCrosshairMove は subscriber に流さない
  → ループ発生せず
```

---

## §7 アンチパターン記録(過去の失敗から)

### 7.1 `visibleBarsMemory` 撤廃(ver 1.72)

**症状**: 銘柄切替後、特定 TF だけ visible range が壊れる(初回表示で全画面に対して数本のバーが拡大表示される、等)。

**原因**: 過去の方式は `<Chart key={`${tf}-${symbol}`}>` で銘柄切替ごとに Chart を remount し、TF キーのモジュールスコープ Map (`visibleBarsMemory.ts`) で width をセッション内に保持していた。`subscribeVisibleLogicalRangeChange` のハンドラが `initialRangeAppliedRef === true` の片方向ゲートで「ライブラリが setData 後に内部的に再計算した値」を memory に書き戻していた。これと remount + setData の自動 emit が組み合わさったとき、特定の到着順序で memory が「壊れた値」で上書きされ、次回 mount 時に壊れた width で復元される。

**現方式**: Chart instance を **TF ごとに 1 つだけ永続化** し、銘柄切替は `symbol` prop の変化として処理する(§4.2)。`subscribeVisibleLogicalRangeChange` は `loadMoreHistory` のトリガーにしか使わず、memory への書き戻しは廃止。`visibleBarsMemory.ts` 自体を撤廃。

**教訓**: 「ライブラリの自動 emit を読み取って memory に書き戻す」は構造的に脆弱。purely-user-driven なイベントだけ拾うか、emit を完全に無視する設計を選ぶ。

### 7.2 LowerTfRangeOverlay の `timeToCoordinate` 経路撤廃(ver 1.76)

**症状**: H4+ 上位 TF pane の帯が pane 全幅を覆う。M5 / M15 / H1 では正常。何度実装し直しても H4+ で再現。

**原因**: 当初実装は `lower.getVisibleTimeRange()` で時刻を求め、`upper.api.timeToX(time)` で px を求める設計だった。`timeToX` は内部で `timeScale.timeToCoordinate` を呼び、それが null のときフォールバックで二分探索 + `logicalToCoordinate` する 2 経路構成。M5→M15 のように下位 TF の logical が上位 TF のバー境界に近い場合は経路 1(`timeToCoordinate`)で正しく返る。M15 → H4 のように lower の時刻が upper のバー境界に乗らないケースだと経路 2 にしか入らないが、そちらにも `null` を返すパス(in-range gap)が残っており、最終的に `x1=0`(pane 左端)が返り帯が左端から始まる症状になっていた。

**修正(ver 1.76 redesign)**:
- 変換経路を **logical 一本化**: `lower visible logical → 時刻 → upper logical → px` を **Overlay 内部の純粋関数 (logicalToTime / timeToLogical) + `logicalToCoordinate` のみ** で完結
- `timeToCoordinate` を一切使わない設計(§2.4)
- snap は **両端 AND 条件のみ**(rightOffset 不一致のみ補正、§2.5)
- broker history 不一致は `logicalToCoordinate` の外挿に任せる(§2.6)

**教訓**:
- 同じ目的に対して 2 つの変換経路が並存していると、入力分布によって挙動が分岐する温床になる。**変換は 1 経路に集約**する
- ライブラリ API の null 返却条件をドキュメントしないと、同じ罠に何度も落ちる(本ファイル §3 が再発防止策)
- bug 修正で局所対処を 3 回以上重ねるな(WORKFLOW §B-1)。再設計で経路を統合する方が早い

### 7.3 LWC `logicalToCoordinate` の fractional 引数不具合(ver 1.76 後続修正)

**症状**: ver 1.76 redesign 後も H4+ 上位 TF pane で帯が pane 全幅を覆う症状が再発。M5 / M15 / H1 では正常。

**原因**: TF 間 projection は時刻補間で fractional logical(例: D1 pane に H4 範囲を投影すると `projFrom = 175.5`)を生む。Overlay は `upper.api.logicalToX(projFrom)` を呼ぶが、LWC の `timeScale.logicalToCoordinate` は **fractional 引数を受け付けず 0 を返す不具合** があった(整数は正しく動く)。`x1 = 0` になり `width = |x2 - x1|` が pane 全幅近くまで膨らむ。

**判断材料となった probe**(D1 pane visible logical [53, 203]):

```
logicalToX(175)   = 758.34  ✓
logicalToX(175.5) = 0       ❌
logicalToX(176)   = 764.54  ✓
```

**修正**: `LowerTfRangeOverlay.tsx` に `logicalToXFractional(handle, logical)` を新設。`floor(logical)` と `floor(logical) + 1` の **整数 2 点で px を取り線形補間** することで LWC の制約を 1 関数で吸収する。詳細は §3.7。

**教訓**:
- ライブラリ API の挙動カタログ(§3)に書く際、「線形外挿あり」のような表記だけでは引数の型(整数 / fractional)による違いを記録できない。**実測値テーブル**を残すと再発防止に直結する
- 純粋関数経路で全部済ませようとしても、最後の `logicalToCoordinate` でライブラリの罠を踏むことがある。**境界の罠は境界 1 箇所で吸収する**(本件は `logicalToXFractional` で吸収)
- 設計レビューチェックリストに「ライブラリ API を fractional / 範囲外 / null で叩いて挙動を確認したか?」を追加する余地あり

### 7.4 「getVisibleTimeRange を Chart 側に持たせる」設計案の却下

LowerTfRangeOverlay 設計時、`ChartHandle` に `getVisibleTimeRange()` を加えて `{from, to, fromAtStart, toAtEnd}` を返す案を検討したが、**snap 判定や時刻換算のロジックが Chart 側に分散** することで「Overlay の挙動を読むのに Chart の実装も並行して読む」必要が出るため却下した。

採用案は「Chart は `getVisibleLogicalRange` の薄ラッパだけ持ち、時刻換算 / snap 判定は Overlay 内部で完結」。Overlay の入力に bar 配列を直接渡すことで、Overlay 単体を読むだけでアルゴリズムが追える。

**教訓**: state や派生情報を「複数の利用者から使われそう」という理由で共通モジュールに置くと、利用者ごとの微妙な要求差が共通モジュールに漏れて肥大する。**まずは利用者ローカルで完結させ、本当に複数 utilizer に共通化が必要なときに昇格させる**。
