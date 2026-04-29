# 描画ツールの状態管理

仕様書 §5.3 / §5.5 の描画ツール（水平線・トレンドライン・フィボナッチ・波動ラベル）を、ツールが増えても複雑さが線形にしか増えないように整理するための設計方針。

← [設計ドキュメント](../ARCHITECTURE.md) | [仕様書](../spec/README.md)

---

## 1. 背景

初期実装では Chart コンポーネントがツールごとのマウスイベント処理（追加・ドラッグ・ホバー）を直接抱え込み、かつ TrainingPage 側に `addMode` のような暗黙フラグを散在させていた。この形のまま、

- トレンドライン（2 クリックで作成、端点と本体で操作が分岐）
- フィボナッチ（2 クリックで作成、複数レベル線を自動生成）
- 波動ラベル（1 クリックで配置）

を追加すると、各ツールの事情が Chart と TrainingPage に垂れ流しになり、保守不能になる。

## 2. 設計原則

- **状態は「何を今やっているか」で分類する**：`addMode` や `dragging` 等の独立フラグを重ねず、1 つの「現在の状態」に集約する。
- **状態 = ツール × 操作目的の単位**で定義する：「水平線を引く」「水平線を移動する」「トレンドラインを引く」「トレンドラインの端点を動かす」…
- **状態は文字列タグで識別**：クラス階層ではなく **discriminated union + switch 分岐** で表現する。
- **状態遷移は純関数**：`(state, event, ctx) → next_state` の単一関数に集約。永続化(`createDrawing` 等)は副作用として fire-and-forget で発火する。
- **横断的関心事は分離する**：ヒットテスト・レンダリング・既定の可視性は「ツールのメタデータ」として別レジストリに集約する。

## 3. 構成要素

```
┌──────────────────────────────────────────────────────────┐
│ SessionPage                                              │
│   - drawings の CRUD を useDrawings で管理               │
│   - ツール選択 UI                                        │
│   - useDrawingInteraction を通じてイベントを仲介          │
└──────────────────┬───────────────────────────────────────┘
                   │
          ┌────────▼────────────┐
          │ DrawingOverlay      │  現状態に基づき SVG/preview を描画
          └────────┬────────────┘
                   │
    ┌──────────────▼────────────────┐
    │ useDrawingInteraction hook    │  state を保持、イベント中継のみ
    │                               │
    │  ├─ state: DrawingState        │ ← discriminated union
    │  ├─ ctx: DispatchContext       │ ← chartApi, drawings, 永続化 API
    │  └─ handlers: {onChartClick…}  │
    └──────────────┬────────────────┘
                   │
    ┌──────────────▼────────────────┐
    │ drawing/state.ts              │  状態 + イベント + dispatch を 1 ファイルに集約
    │  ├─ DrawingState union         │
    │  ├─ DrawingEvent union         │
    │  ├─ dispatchEvent(s,e,ctx)     │
    │  ├─ cursorOf / previewOf       │ ← UI 用 selectors
    │  └─ activeToolOf / hoveredIdOf │
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

## 4. 状態(DrawingState)

状態は文字列タグで識別される discriminated union として 1 箇所に定義する。

```ts
type DrawingState =
  | { kind: 'idle'; cursor: string; hoveredId: number | null }
  | { kind: 'drawing-line' }
  | { kind: 'drawing-trendline'; firstPoint: PP | null; currentPoint: PP | null }
  | { kind: 'drawing-fibonacci'; firstPoint: PP | null; currentPoint: PP | null }
  | { kind: 'drawing-wave-label'; wave: WaveLabel; previewPoint: PP | null }
  // WaveLabel = '1'|'2'|'3'|'4'|'5' (推進波) | 'A'|'B'|'C' (補正波)
  //  ver 1.63 で文字列に統一(JSON 上の型を 1 種類に揃え consumer の分岐を減らす)
  | { kind: 'moving-line'; original: Drawing; preview: Drawing }
  | { kind: 'moving-trendline-handle'; original: Drawing; preview: Drawing; handleIndex: number }
  | { kind: 'moving-trendline-body'; original: Drawing; preview: Drawing; anchor: PP }
  | { kind: 'moving-fibonacci-handle'; original: Drawing; preview: Drawing; handleIndex: number }
  | { kind: 'moving-fibonacci-body'; original: Drawing; preview: Drawing; anchor: PP }
  | { kind: 'moving-wave-label'; original: Drawing; preview: Drawing }

type PP = { t: number; price: number }
```

- `idle`: 何も進行していない待機状態。マウス位置から hoveredId/cursor を導出
- `drawing-*`: 新規作成中（1 クリック完結 / 2 クリック完結）
- `moving-*`: 既存描画の編集中。`original` は確定値、`preview` は未保存の中間値

旧設計(11 個のクラス)では、`Drawing*Mode`/`Moving*Mode`/`IdleMode` がそれぞれ別ファイルに別クラスとして実装されており、共通プロトコル(`onEnter` / `onExit` / `getPreview` / `cursor` ゲッタ等)を継承で揃えていたため、定型コードが大量に重複していた。union + selector で同等の意味を表現できる。

## 5. イベント(DrawingEvent)

```ts
type DrawingEvent =
  | { type: 'mouse-move'; payload: PointerPayload }
  | { type: 'mouse-down'; payload: PointerPayload }
  | { type: 'mouse-up';   payload: PointerPayload }
  | { type: 'click';      payload: PointerPayload }
  | { type: 'escape' }
  | { type: 'select-tool'; tool: DrawingKind | null; wave?: WaveLabel }
```

`escape` と `select-tool` は **どの状態でも一律処理**（前者は idle に戻る、後者は対応する `drawing-*` 状態に遷移）。それ以外は現状態の handler に委譲する。

## 6. DispatchContext

dispatch 関数が使って良い外界 API。

```ts
interface DispatchContext {
  chartApi: ChartApi                   // 座標変換 (priceToCoordinate 等)
  drawings: Drawing[]                  // 既存描画(ヒットテスト用)
  activeTimeframe: string              // 作成時の timeframe 記録用
  createDrawing(body: CreateDrawingBody): Promise<Drawing>
  updateDrawing(id: number, patch: UpdateDrawingPatch): Promise<void>
  deleteDrawing(id: number): Promise<void>
}
```

旧 `ModeContext.setMode` は撤去。状態遷移は `dispatchEvent` の戻り値として表現する。

## 7. dispatchEvent

```ts
function dispatchEvent(state: DrawingState, event: DrawingEvent, ctx: DispatchContext): DrawingState
```

- 純粋関数として「次の状態」を返す
- 永続化(`createDrawing` / `updateDrawing`)は副作用として fire-and-forget で発火する。結果は `drawings` 配列の再フェッチ経由で UI に反映される
- ESC は常に `idle` に戻る。作成途中のデータは破棄
- ツール選択(`select-tool`)も常に対応する `drawing-*` 状態に遷移する

## 8. selector 関数

UI レンダリングに必要な派生値は state から関数で取り出す。

```ts
cursorOf(state)       → string                // CSS cursor
previewOf(state)      → Drawing | null        // SVG オーバーレイのプレビュー
activeToolOf(state)   → DrawingKind | null    // ボタンハイライト
activeWaveOf(state)   → WaveLabel | null      // 波動ラベル選択中('1'-'5' 推進波 / 'A'-'C' 補正波、文字列統一)
hoveredIdOf(state)    → number | null         // §5.3 TF バッジ表示用
isMovingState(state)  → boolean               // チャートのスクロール抑止判定
```

## 9. 状態遷移の例

### 水平線の作成

```
idle
  │  select-tool('line')
  ▼
drawing-line
  │  click → ctx.createDrawing(...) (fire-and-forget) → idle
  ▼
idle
```

### 水平線の移動

```
idle
  │  mouse-move: ヒットテスト陽性 → cursor / hoveredId 更新 (idle のまま)
  │
  │  mouse-down: ヒットテスト陽性 → moving-line { original, preview = original }
  ▼
moving-line
  │  mouse-move: preview 更新
  │
  │  mouse-up: ctx.updateDrawing(...) (fire-and-forget) → idle
  │  escape:                                                idle
  ▼
idle
```

### スクロール抑止

`moving-*` 状態の間はチャートのドラッグパンと描画ドラッグが干渉するため抑止する。状態遷移を hook 側で監視し、`isMovingState(prev)` と `isMovingState(next)` の差分から `chartApi.setScrollEnabled(boolean)` を呼ぶ。dispatch 関数は副作用を持たない。

## 10. ツールメタデータレジストリ

ツール単位のメタ情報は `drawing/tools/` に 1 ファイル 1 ツール、`registry.ts` で集約。

```ts
export const TOOLS: Record<DrawingKind, ToolMetadata | undefined> = {
  line: lineTool,
  trendline: trendlineTool,
  fibonacci: fibonacciTool,
  wave_label: waveLabelTool,
}

export interface ToolMetadata {
  kind: DrawingKind
  label: string
  icon: string
  defaultVisibleTfs: string[] | null
  hitTest(d: Drawing, px: PointPx, api: ChartApi): HitResult | null
  renderOverlay?(d: Drawing, api: ChartApi): ReactNode
}
```

`idle` 状態の handler は `findHit(drawings, px, api)` でヒットテストし、ヒット時に対応する `moving-*` 状態を生成する。

## 11. 新しいツールを追加する手順

1. **DB / API**: `Drawing.kind` の enum 値を追加（必要なら `data` の構造を定義）
2. **tools/{kind}.ts(x)**: `ToolMetadata` を実装し `TOOLS` レジストリに登録
3. **state.ts**: `DrawingState` union に `drawing-{kind}` / `moving-{kind}-*` を追加し、`dispatchEvent` の switch に handler を足す
4. **selector**: `cursorOf` / `previewOf` / `activeToolOf` の switch に case を追加
5. **DrawingTools ボタン**: `TOOLS` から生成されるため自動

`state.ts` を 1 ファイル開いて該当箇所に追記するだけで完結する（旧設計では「Drawing{Kind}Mode.ts と Moving{Kind}Mode.ts と IdleMode の switch 3 箇所」を同時更新する必要があった）。

## 12. 非採用の代替案

- **クラス階層 (旧設計)**: 11 ファイル × クラス継承で重複が多く、状態の全体像をひと目で把握できなかった。union+switch に統合して 1 ファイル化。
- **Chart 側にツールロジックを直接書く**: 初期実装で問題になった原因。再発を避ける。
- **lightweight-charts v5 + ISeriesPrimitive**: v4 から v5 への破壊的変更が多く、コストが大きい。将来の移行余地は残す。

---

*最終更新: 2026-04-29 (ver 1.63 で 波動ラベルに ABC 補正波を追加。`WaveValue` 型を `'1'|'2'|'3'|'4'|'5'|'A'|'B'|'C'` の文字列に統一)*

*2026-04-26 (ver 1.55 で 11 クラスから tagged union + 単一 dispatch 関数に統合)*
