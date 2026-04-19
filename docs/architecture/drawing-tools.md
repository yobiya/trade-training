# 描画ツールの状態管理

仕様書 §5.3 / §5.5 の描画ツール（水平線・トレンドライン・フィボナッチ・テキストラベル）を、ツールが増えても複雑さが線形にしか増えないように整理するための設計方針。

← [docs index](../Setup.md) | [仕様書](../spec/README.md)

---

## 1. 背景

初期実装では Chart コンポーネントがツールごとのマウスイベント処理（追加・ドラッグ・ホバー）を直接抱え込み、かつ TrainingPage 側に `addMode` のような暗黙フラグを散在させていた。この形のまま、

- トレンドライン（2 クリックで作成、端点と本体で操作が分岐）
- フィボナッチ（2 クリックで作成、複数レベル線を自動生成）
- テキストラベル（1 クリック + テキスト入力、連続採番）

を追加すると、各ツールの事情が Chart と TrainingPage に垂れ流しになり、保守不能になる。

## 2. 設計原則

- **状態は「何を今やっているか」で分類する**：`addMode` や `dragging` 等の独立フラグを重ねず、1 つの「現在のモード」に集約する。
- **モードはツール × 操作目的の単位**で定義する：「水平線を引く」「水平線を移動する」「トレンドラインを引く」「トレンドラインの端点を動かす」…
- **各モードは自分の責務だけを知る**：あるモードのコードは他のモードの存在を意識しない。モードが他のモードに切り替えるときだけ、切り替え先のインスタンスを生成する。
- **横断的関心事は分離する**：ヒットテスト・レンダリング・既定の可視性は「ツールのメタデータ」として別レジストリに集約する。

## 3. 構成要素

```
┌──────────────────────────────────────────────────────────┐
│ TrainingPage                                             │
│   - drawings の CRUD を useDrawings で管理               │
│   - ツール選択 UI                                        │
│   - useDrawingInteraction を通じてイベントを仲介          │
└──────────────────┬───────────────────────────────────────┘
                   │
          ┌────────▼────────────┐
          │ DrawingOverlay      │  現行モードに基づき SVG/preview を描画
          └────────┬────────────┘
                   │
    ┌──────────────▼────────────────┐
    │ useDrawingInteraction hook    │  mode を state に保持、イベント中継のみ
    │                               │
    │  ├─ mode: DrawingMode          │
    │  ├─ ctx: ModeContext           │ ← chartApi, drawings, 永続化 API
    │  └─ handlers: {onChartClick…}  │
    └──────────────┬────────────────┘
                   │
    ┌──────────────▼────────────────┐
    │ modes/                        │  ツール × 操作目的のクラス群
    │  ├─ IdleMode                   │
    │  ├─ DrawingLineMode            │
    │  ├─ MovingLineMode             │
    │  ├─ DrawingTrendlineMode       │  (将来)
    │  ├─ MovingTrendlineHandleMode  │  (将来)
    │  ├─ MovingTrendlineBodyMode    │  (将来)
    │  ├─ DrawingFibonacciMode       │  (将来)
    │  ├─ DrawingLabelMode           │  (将来)
    │  └─ …                           │
    └──────────────┬────────────────┘
                   │ メタ情報参照
    ┌──────────────▼────────────────┐
    │ tools/registry.ts             │  ツール固有の横断情報
    │  ├─ hitTest                    │
    │  ├─ render (SVG | null)        │
    │  ├─ defaultVisibleTfs          │
    │  └─ toolButton                 │
    └───────────────────────────────┘
```

## 4. DrawingMode インタフェース

```ts
export interface DrawingMode {
  readonly id: string                  // 'idle' | 'drawing-line' | 'moving-line' | ...
  readonly cursor?: string             // カーソルスタイル
  onEnter?(ctx: ModeContext): void
  onExit?(ctx: ModeContext): void
  onChartClick?(e: PointerPayload, ctx: ModeContext): void
  onMouseMove?(e: PointerPayload, ctx: ModeContext): void
  onMouseDown?(e: PointerPayload, ctx: ModeContext): void
  onMouseUp?(e: PointerPayload, ctx: ModeContext): void
  onEscape?(ctx: ModeContext): void
  /** 作成中・編集中の仮描画。SVG オーバーレイが呼ぶ */
  getPreview?(): Drawing | null
}
```

各モードは自身のルールに従って `ctx.setMode(new 別のモード())` で遷移する。呼ばれないイベントには実装不要。

## 5. ModeContext

モードの外側（hook）が提供する、モードが使って良い API。

```ts
export interface ModeContext {
  chartApi: ChartApi                   // 座標変換 (priceToCoordinate 等)
  drawings: Drawing[]                  // 既存描画(ヒットテスト用)
  activeTimeframe: string              // 作成時の timeframe 記録用
  setMode(next: DrawingMode): void
  createDrawing(body: CreateDrawingRequest): Promise<Drawing>
  updateDrawing(id: number, patch: UpdateDrawingPatch): Promise<void>
  deleteDrawing(id: number): Promise<void>
}

export interface ChartApi {
  priceToY(price: number): number | null
  yToPrice(y: number): number | null
  timeToX(time: number): number | null
  xToTime(x: number): number | null
}
```

## 6. モード一覧（初期 + 予定）

| モード                        | 遷移元           | 役割                                                | 備考                    |
| ----------------------------- | ---------------- | --------------------------------------------------- | ----------------------- |
| `IdleMode`                    | 初期 / 各操作完了 | ヒットテストしてホバー時のカーソル変更、クリック時に編集モードへ遷移 | 常時待機 |
| `DrawingLineMode`             | ツール選択       | 1 クリックで水平線を作成                            | Phase 2a で実装         |
| `MovingLineMode`              | Idle のクリック  | y ドラッグで価格を更新                              | Phase 2a で実装         |
| `DrawingTrendlineMode`        | ツール選択       | 2 点クリックで作成、マウスムーブ中はプレビュー表示  | (将来)                  |
| `MovingTrendlineHandleMode`   | Idle のクリック  | 端点を移動                                          | (将来)                  |
| `MovingTrendlineBodyMode`     | Idle のクリック  | 全体を平行移動                                      | (将来)                  |
| `DrawingFibonacciMode`        | ツール選択       | 2 点クリックで作成                                  | (将来)                  |
| `MovingFibonacciHandleMode`   | Idle のクリック  | 端点を移動(レベル線は自動追従)                      | (将来)                  |
| `DrawingLabelMode`            | ツール選択       | 1 クリック + テキスト入力、連続採番をサポート       | (将来)                  |
| `MovingLabelMode`             | Idle のクリック  | テキストの位置を移動                                | (将来)                  |

## 7. 状態遷移の例

### 水平線の作成

```
Idle
  │  toolSelected('line')
  ▼
DrawingLine
  │  onChartClick: createDrawing → setMode(Idle)
  ▼
Idle
```

### 水平線の移動

```
Idle
  │  onMouseMove: ヒットテスト陽性 → cursor 変更 (Idle のまま)
  │
  │  onMouseDown: ヒットテスト陽性 → setMode(MovingLine(target))
  ▼
MovingLine
  │  onMouseMove: preview 更新 (楽観的に applyOptions)
  │
  │  onMouseUp: updateDrawing → setMode(Idle)
  │  onEscape:                    setMode(Idle)
  ▼
Idle
```

### ESC によるキャンセル

どのモードも `onEscape` で `setMode(new IdleMode())` に戻せる。作成途中のデータは破棄される。

## 8. ツールメタデータレジストリ

モードに持たせると重複するため、ツール単位のメタ情報は 1 箇所にまとめる。

```ts
// drawing/tools/registry.ts
export const TOOLS: Record<DrawingKind, ToolMetadata> = {
  line: lineTool,
  trendline: trendlineTool,   // 将来
  fibonacci: fibonacciTool,   // 将来
  label: labelTool,           // 将来
}

export interface ToolMetadata {
  kind: DrawingKind
  label: string
  icon: string                            // ボタン表示
  defaultVisibleTfs: string[] | null      // 仕様書 §5.3 既定
  hitTest(d: Drawing, px: PointPx, api: ChartApi): HitResult | null
  renderOverlay?(d: Drawing, api: ChartApi): SVGElement | null  // null = ライブラリ標準(createPriceLine 等)に委譲
}

export interface HitResult {
  drawingId: number
  kind: DrawingKind
  part: 'body' | 'handle'
  handleIndex?: number
}
```

`IdleMode` は `TOOLS[d.kind].hitTest` を走査し、ヒット時に適切な `Moving*Mode` を生成して遷移する。

## 9. 新しいツールを追加する手順

1. **DB / API**: `Drawing.kind` の enum 値を追加（必要なら `data` の構造を定義）
2. **tools/{kind}.ts**: `ToolMetadata` を実装し `TOOLS` レジストリに登録
3. **modes/Drawing{Kind}Mode.ts**: 作成フローを実装
4. **modes/Moving{Kind}...Mode.ts**: 編集フローを実装（ツールが複数の編集パターンを持つなら複数作る）
5. **IdleMode の遷移**: `buildMovingMode(hit)` 関数に case を追加
6. **DrawingTools ボタン**: `TOOLS` から生成されるため自動

既存ツールのコードには触らず、追加分だけで完結する。

## 10. 非採用の代替案

- **フラット state machine (入力ベース reducer)**: 遷移テーブルが肥大化し、ツール追加で全 case を見直す必要がある。
- **Chart 側にツールロジックを直接書く**: 現状問題になった原因。再発を避ける。
- **lightweight-charts v5 + ISeriesPrimitive**: v4 から v5 への破壊的変更が多く、コストが大きい。将来の移行余地は残す。

---

*最終更新: 2026-04-19*
