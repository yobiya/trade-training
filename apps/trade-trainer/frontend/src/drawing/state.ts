import type { Drawing, DrawingKind } from '../api/types'
import { lineTool } from './tools/line'
import { fibonacciTool, getFibPoints } from './tools/fibonacci'
import { findHit } from './tools/registry'
import { trendlineTool, getTrendlinePoints } from './tools/trendline'
import { vlineTool } from './tools/vline'
import { waveLabelTool, getWaveLabelData, nextWave, type WaveValue } from './tools/wave_label'
import type {
  ChartApi,
  CreateDrawingBody,
  HitResult,
  PointPx,
  PointerPayload,
  UpdateDrawingPatch,
} from './types'

// §5.5.5 SL/TP 線の hit-test 距離(水平線描画と同じ)
const TRADE_LINE_HIT_PX = 6

export type TradeLineHandle = 'sl' | 'tp'

export type TradeLinesSnapshot = {
  sl: number | null
  tp: number | null
}

/**
 * 描画ツールの状態管理(tagged union + 単一 dispatch 関数で実装)。
 * 詳細: docs/architecture/drawing-tools.md
 */

type PP = { t: number; price: number }
// 推進波 1-5 + 補正波 A/B/C を表す型は wave_label.tsx に集約
type Wave = WaveValue

export type DrawingState =
  | { kind: 'idle'; cursor: string; hoveredId: number | null }
  | { kind: 'drawing-line' }
  | { kind: 'drawing-vline' }
  | { kind: 'drawing-trendline'; firstPoint: PP | null; currentPoint: PP | null }
  | { kind: 'drawing-fibonacci'; firstPoint: PP | null; currentPoint: PP | null }
  | { kind: 'drawing-wave-label'; wave: Wave; previewPoint: PP | null }
  | { kind: 'moving-line'; original: Drawing; preview: Drawing }
  | { kind: 'moving-vline'; original: Drawing; preview: Drawing }
  | { kind: 'moving-trendline-handle'; original: Drawing; preview: Drawing; handleIndex: number }
  | { kind: 'moving-trendline-body'; original: Drawing; preview: Drawing; anchorPx: PointPx; anchorPrice: number }
  | { kind: 'moving-fibonacci-handle'; original: Drawing; preview: Drawing; handleIndex: number }
  | { kind: 'moving-fibonacci-body'; original: Drawing; preview: Drawing; anchorPx: PointPx; anchorPrice: number }
  | { kind: 'moving-wave-label'; original: Drawing; preview: Drawing }
  // §5.5.5 SL/TP の drag 移動。Drawing ではなく Trade.sl / Trade.tp を直接更新する
  // (描画モデルは汚さない、データの真実は session.json 内の Trade)。state machine の
  // hit-test/drag インフラだけ共有する。original / preview は price (number)。
  | { kind: 'moving-trade-line'; handle: TradeLineHandle; original: number; preview: number }

export type DrawingEvent =
  | { type: 'mouse-move'; payload: PointerPayload }
  | { type: 'mouse-down'; payload: PointerPayload }
  | { type: 'mouse-up'; payload: PointerPayload }
  | { type: 'click'; payload: PointerPayload }
  | { type: 'escape' }
  | { type: 'select-tool'; tool: DrawingKind | null; wave?: Wave }

export interface DispatchContext {
  chartApi: ChartApi
  drawings: Drawing[]
  activeTimeframe: string
  createDrawing(body: CreateDrawingBody): Promise<Drawing>
  updateDrawing(id: number, patch: UpdateDrawingPatch): Promise<void>
  deleteDrawing(id: number): Promise<void>
  // §5.5.5 SL/TP の drag 移動。null = drag 不可(分析中・振り返り・無トレード)
  tradeLines: TradeLinesSnapshot | null
  updateTradeLine?(handle: TradeLineHandle, price: number): Promise<void>
}

export function idleState(): DrawingState {
  return { kind: 'idle', cursor: 'default', hoveredId: null }
}

// -----------------------------------------------------------------------------
// dispatch
// -----------------------------------------------------------------------------

export function dispatchEvent(
  state: DrawingState,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'escape') return idleState()
  if (event.type === 'select-tool') return startToolState(event.tool, event.wave)

  switch (state.kind) {
    case 'idle': return reduceIdle(state, event, ctx)
    case 'drawing-line': return reduceDrawingLine(state, event, ctx)
    case 'drawing-vline': return reduceDrawingVline(state, event, ctx)
    case 'drawing-trendline': return reduceDrawingTrendline(state, event, ctx)
    case 'drawing-fibonacci': return reduceDrawingFibonacci(state, event, ctx)
    case 'drawing-wave-label': return reduceDrawingWaveLabel(state, event, ctx)
    case 'moving-line': return reduceMovingLine(state, event, ctx)
    case 'moving-vline': return reduceMovingVline(state, event, ctx)
    case 'moving-trendline-handle': return reduceMovingTrendlineHandle(state, event, ctx)
    case 'moving-trendline-body': return reduceMovingTrendlineBody(state, event, ctx)
    case 'moving-fibonacci-handle': return reduceMovingFibonacciHandle(state, event, ctx)
    case 'moving-fibonacci-body': return reduceMovingFibonacciBody(state, event, ctx)
    case 'moving-wave-label': return reduceMovingWaveLabel(state, event, ctx)
    case 'moving-trade-line': return reduceMovingTradeLine(state, event, ctx)
  }
}

// -----------------------------------------------------------------------------
// selectors
// -----------------------------------------------------------------------------

export function cursorOf(state: DrawingState): string {
  switch (state.kind) {
    case 'idle': return state.cursor
    case 'drawing-line':
    case 'drawing-vline':
    case 'drawing-trendline':
    case 'drawing-fibonacci':
    case 'drawing-wave-label': return 'crosshair'
    case 'moving-line':
    case 'moving-trade-line': return 'ns-resize'
    case 'moving-vline': return 'ew-resize'
    case 'moving-trendline-body':
    case 'moving-fibonacci-body':
    case 'moving-wave-label': return 'move'
    case 'moving-trendline-handle':
    case 'moving-fibonacci-handle': return 'grabbing'
  }
}

export function previewOf(state: DrawingState): Drawing | null {
  switch (state.kind) {
    case 'drawing-trendline':
      if (!state.firstPoint || !state.currentPoint) return null
      return previewDrawing('trendline', { points: [state.firstPoint, state.currentPoint] })
    case 'drawing-fibonacci':
      if (!state.firstPoint || !state.currentPoint) return null
      return previewDrawing('fibonacci', { points: [state.firstPoint, state.currentPoint] })
    case 'drawing-wave-label':
      if (!state.previewPoint) return null
      return previewDrawing('wave_label', {
        t: state.previewPoint.t,
        price: state.previewPoint.price,
        wave: state.wave,
      })
    case 'moving-line':
    case 'moving-vline':
    case 'moving-trendline-handle':
    case 'moving-trendline-body':
    case 'moving-fibonacci-handle':
    case 'moving-fibonacci-body':
    case 'moving-wave-label':
      return state.preview
    default:
      return null
  }
}

export function activeToolOf(state: DrawingState): DrawingKind | null {
  switch (state.kind) {
    case 'drawing-line': return 'line'
    case 'drawing-vline': return 'vline'
    case 'drawing-trendline': return 'trendline'
    case 'drawing-fibonacci': return 'fibonacci'
    case 'drawing-wave-label': return 'wave_label'
    default: return null
  }
}

export function activeWaveOf(state: DrawingState): Wave | null {
  return state.kind === 'drawing-wave-label' ? state.wave : null
}

export function hoveredIdOf(state: DrawingState): number | null {
  return state.kind === 'idle' ? state.hoveredId : null
}

export function isMovingState(state: DrawingState): boolean {
  return state.kind.startsWith('moving-')
}

/**
 * §5.5.5: SL/TP drag 中の preview 値。SessionPage が priceLine 描画時に元値を上書きする。
 * 非 drag 時は null(SessionPage は Trade.sl / Trade.tp を使う)。
 */
export function tradeLinePreviewOf(
  state: DrawingState,
): { handle: TradeLineHandle; price: number } | null {
  return state.kind === 'moving-trade-line'
    ? { handle: state.handle, price: state.preview }
    : null
}

/**
 * §5.5.5: SL/TP の hit-test。同一 y 距離なら SL を優先(stop loss = 直接的な下落リスクを表すため)。
 * `tradeLines === null` または両方 `null` のときは hit しない。
 */
function findTradeLineHit(
  tradeLines: TradeLinesSnapshot | null,
  px: PointPx,
  api: ChartApi,
): TradeLineHandle | null {
  if (!tradeLines) return null
  for (const handle of ['sl', 'tp'] as const) {
    const price = tradeLines[handle]
    if (price === null) continue
    const y = api.priceToY(price)
    if (y === null) continue
    if (Math.abs(px.y - y) <= TRADE_LINE_HIT_PX) return handle
  }
  return null
}

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function startToolState(tool: DrawingKind | null, wave?: Wave): DrawingState {
  if (tool === null) return idleState()
  switch (tool) {
    case 'line': return { kind: 'drawing-line' }
    case 'vline': return { kind: 'drawing-vline' }
    case 'trendline': return { kind: 'drawing-trendline', firstPoint: null, currentPoint: null }
    case 'fibonacci': return { kind: 'drawing-fibonacci', firstPoint: null, currentPoint: null }
    case 'wave_label':
      if (wave === undefined) return idleState()
      return { kind: 'drawing-wave-label', wave, previewPoint: null }
    default: return idleState()
  }
}

function previewDrawing(kind: DrawingKind, data: Record<string, unknown>): Drawing {
  return {
    id: -1,
    session_id: '',
    symbol: null,
    kind,
    data,
    label: null,
    timeframe: null,
    visible_on_timeframes: null,
  }
}

function cursorForHit(hit: HitResult): string {
  if (hit.kind === 'line') return 'ns-resize'
  if (hit.kind === 'vline') return 'ew-resize'
  if (hit.part === 'handle') return 'grab'
  return 'move'
}

function buildMovingState(
  hit: HitResult,
  payload: PointerPayload,
  ctx: DispatchContext,
): DrawingState | null {
  const drawing = ctx.drawings.find(d => d.id === hit.drawingId)
  if (!drawing) return null
  switch (hit.kind) {
    case 'line':
      return { kind: 'moving-line', original: drawing, preview: drawing }
    case 'vline':
      return { kind: 'moving-vline', original: drawing, preview: drawing }
    case 'trendline':
      if (hit.part === 'handle' && hit.handleIndex !== undefined) {
        return {
          kind: 'moving-trendline-handle',
          original: drawing,
          preview: drawing,
          handleIndex: hit.handleIndex,
        }
      }
      if (payload.point.time === null) return null
      return {
        kind: 'moving-trendline-body',
        original: drawing,
        preview: drawing,
        anchorPx: payload.pointerPx,
        anchorPrice: payload.point.price,
      }
    case 'fibonacci':
      if (hit.part === 'handle' && hit.handleIndex !== undefined) {
        return {
          kind: 'moving-fibonacci-handle',
          original: drawing,
          preview: drawing,
          handleIndex: hit.handleIndex,
        }
      }
      if (payload.point.time === null) return null
      return {
        kind: 'moving-fibonacci-body',
        original: drawing,
        preview: drawing,
        anchorPx: payload.pointerPx,
        anchorPrice: payload.point.price,
      }
    case 'wave_label':
      return { kind: 'moving-wave-label', original: drawing, preview: drawing }
    default:
      return null
  }
}

// -----------------------------------------------------------------------------
// per-state reducers
// -----------------------------------------------------------------------------

function reduceIdle(
  state: Extract<DrawingState, { kind: 'idle' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    // §5.5.5 SL/TP は描画より優先(同距離なら SL/TP を掴めるようにする)
    const tradeHit = findTradeLineHit(ctx.tradeLines, event.payload.pointerPx, ctx.chartApi)
    if (tradeHit) return { kind: 'idle', cursor: 'ns-resize', hoveredId: null }
    const hit = findHit(ctx.drawings, event.payload.pointerPx, ctx.chartApi)
    return {
      kind: 'idle',
      cursor: hit ? cursorForHit(hit) : 'default',
      hoveredId: hit?.drawingId ?? null,
    }
  }
  if (event.type === 'mouse-down') {
    // §5.5.5 SL/TP の drag 開始(updateTradeLine が無いと commit できないので idle のまま)
    if (ctx.tradeLines && ctx.updateTradeLine) {
      const tradeHit = findTradeLineHit(ctx.tradeLines, event.payload.pointerPx, ctx.chartApi)
      if (tradeHit) {
        const price = ctx.tradeLines[tradeHit] as number  // findTradeLineHit が non-null を保証
        return { kind: 'moving-trade-line', handle: tradeHit, original: price, preview: price }
      }
    }
    const hit = findHit(ctx.drawings, event.payload.pointerPx, ctx.chartApi)
    if (!hit) return state
    return buildMovingState(hit, event.payload, ctx) ?? state
  }
  return state
}

function reduceDrawingLine(
  state: Extract<DrawingState, { kind: 'drawing-line' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'click') {
    void ctx.createDrawing({
      kind: 'line',
      data: { price: event.payload.point.price },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: lineTool.defaultVisibleTfs,
    })
    return idleState()
  }
  return state
}

function reduceDrawingVline(
  state: Extract<DrawingState, { kind: 'drawing-vline' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'click') {
    if (event.payload.point.time === null) return state
    void ctx.createDrawing({
      kind: 'vline',
      data: { t: event.payload.point.time },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: vlineTool.defaultVisibleTfs,
    })
    return idleState()
  }
  return state
}

function reduceDrawingTrendline(
  state: Extract<DrawingState, { kind: 'drawing-trendline' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'click') {
    if (event.payload.point.time === null) return state
    const p: PP = { t: event.payload.point.time, price: event.payload.point.price }
    if (state.firstPoint === null) {
      return { kind: 'drawing-trendline', firstPoint: p, currentPoint: p }
    }
    void ctx.createDrawing({
      kind: 'trendline',
      data: { points: [state.firstPoint, p] },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: trendlineTool.defaultVisibleTfs,
    })
    return idleState()
  }
  if (event.type === 'mouse-move') {
    if (state.firstPoint === null || event.payload.point.time === null) return state
    return {
      ...state,
      currentPoint: { t: event.payload.point.time, price: event.payload.point.price },
    }
  }
  return state
}

function reduceDrawingFibonacci(
  state: Extract<DrawingState, { kind: 'drawing-fibonacci' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'click') {
    if (event.payload.point.time === null) return state
    const p: PP = { t: event.payload.point.time, price: event.payload.point.price }
    if (state.firstPoint === null) {
      return { kind: 'drawing-fibonacci', firstPoint: p, currentPoint: p }
    }
    void ctx.createDrawing({
      kind: 'fibonacci',
      data: { points: [state.firstPoint, p] },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: fibonacciTool.defaultVisibleTfs,
    })
    return idleState()
  }
  if (event.type === 'mouse-move') {
    if (state.firstPoint === null || event.payload.point.time === null) return state
    return {
      ...state,
      currentPoint: { t: event.payload.point.time, price: event.payload.point.price },
    }
  }
  return state
}

function reduceDrawingWaveLabel(
  state: Extract<DrawingState, { kind: 'drawing-wave-label' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'click') {
    if (event.payload.point.time === null) return state
    void ctx.createDrawing({
      kind: 'wave_label',
      data: { t: event.payload.point.time, price: event.payload.point.price, wave: state.wave },
      timeframe: ctx.activeTimeframe,
      visible_on_timeframes: waveLabelTool.defaultVisibleTfs,
    })
    // §5.3 auto-advance: 次の波があれば配置モードを継続、終端(5 / C)は idle へ
    const next = nextWave(state.wave)
    if (next === null) return idleState()
    return { kind: 'drawing-wave-label', wave: next, previewPoint: null }
  }
  if (event.type === 'mouse-move' && event.payload.point.time !== null) {
    return {
      ...state,
      previewPoint: { t: event.payload.point.time, price: event.payload.point.price },
    }
  }
  return state
}

/**
 * trendline / fibonacci の body drag を **pixel(logical)空間** で計算する。
 *
 * 時間空間で `dt = current.t - anchor.t` を使うと weekend gap (~65h) を跨いだとき
 * dt が実時間ベースで肥大化し、`original.t + dt` が gap 内の存在しない時刻へ落ちる。
 * pixel 空間で drag → `xToTime` で bar 時刻にスナップする経路なら、weekend を跨いでも
 * 「N bars 単位」の semantic で確実に bar 時刻が得られる。
 *
 * price は gap の概念がないので時間空間の dp をそのまま使う。
 */
function shiftPointsByPixel(
  orig: { t: number; price: number }[],
  dx: number,
  dp: number,
  chartApi: ChartApi,
): { t: number; price: number }[] | null {
  const result: { t: number; price: number }[] = []
  for (const p of orig) {
    const origX = chartApi.timeToX(p.t)
    if (origX === null) return null
    const newT = chartApi.xToTime(origX + dx)
    if (newT === null) return null
    result.push({ t: newT, price: p.price + dp })
  }
  return result
}

function reduceMovingLine(
  state: Extract<DrawingState, { kind: 'moving-line' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    return {
      ...state,
      preview: {
        ...state.original,
        data: { ...state.original.data, price: event.payload.point.price },
      },
    }
  }
  if (event.type === 'mouse-up') {
    void ctx.updateDrawing(state.original.id, { data: { price: event.payload.point.price } })
    return idleState()
  }
  return state
}

function reduceMovingVline(
  state: Extract<DrawingState, { kind: 'moving-vline' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    if (event.payload.point.time === null) return state
    return {
      ...state,
      preview: {
        ...state.original,
        data: { ...state.original.data, t: event.payload.point.time },
      },
    }
  }
  if (event.type === 'mouse-up') {
    if (event.payload.point.time !== null && state.preview !== state.original) {
      void ctx.updateDrawing(state.original.id, { data: { t: event.payload.point.time } })
    }
    return idleState()
  }
  return state
}

function reduceMovingTrendlineHandle(
  state: Extract<DrawingState, { kind: 'moving-trendline-handle' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    if (event.payload.point.time === null) return state
    const orig = getTrendlinePoints(state.original)
    if (!orig) return state
    const t = event.payload.point.time
    const price = event.payload.point.price
    const newPoints = orig.map((p, i) => (i === state.handleIndex ? { t, price } : p))
    return {
      ...state,
      preview: { ...state.original, data: { points: newPoints } },
    }
  }
  if (event.type === 'mouse-up') {
    if (state.preview !== state.original) {
      void ctx.updateDrawing(state.original.id, { data: state.preview.data })
    }
    return idleState()
  }
  return state
}

function reduceMovingTrendlineBody(
  state: Extract<DrawingState, { kind: 'moving-trendline-body' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    const orig = getTrendlinePoints(state.original)
    if (!orig) return state
    const dx = event.payload.pointerPx.x - state.anchorPx.x
    const dp = event.payload.point.price - state.anchorPrice
    const newPoints = shiftPointsByPixel(orig, dx, dp, ctx.chartApi)
    if (newPoints === null) return state
    return {
      ...state,
      preview: { ...state.original, data: { points: newPoints } },
    }
  }
  if (event.type === 'mouse-up') {
    if (state.preview !== state.original) {
      void ctx.updateDrawing(state.original.id, { data: state.preview.data })
    }
    return idleState()
  }
  return state
}

function reduceMovingFibonacciHandle(
  state: Extract<DrawingState, { kind: 'moving-fibonacci-handle' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    if (event.payload.point.time === null) return state
    const orig = getFibPoints(state.original)
    if (!orig) return state
    const t = event.payload.point.time
    const price = event.payload.point.price
    const newPoints = orig.map((p, i) => (i === state.handleIndex ? { t, price } : p))
    return {
      ...state,
      preview: { ...state.original, data: { points: newPoints } },
    }
  }
  if (event.type === 'mouse-up') {
    if (state.preview !== state.original) {
      void ctx.updateDrawing(state.original.id, { data: state.preview.data })
    }
    return idleState()
  }
  return state
}

function reduceMovingFibonacciBody(
  state: Extract<DrawingState, { kind: 'moving-fibonacci-body' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    const orig = getFibPoints(state.original)
    if (!orig) return state
    const dx = event.payload.pointerPx.x - state.anchorPx.x
    const dp = event.payload.point.price - state.anchorPrice
    const newPoints = shiftPointsByPixel(orig, dx, dp, ctx.chartApi)
    if (newPoints === null) return state
    return {
      ...state,
      preview: { ...state.original, data: { points: newPoints } },
    }
  }
  if (event.type === 'mouse-up') {
    if (state.preview !== state.original) {
      void ctx.updateDrawing(state.original.id, { data: state.preview.data })
    }
    return idleState()
  }
  return state
}

function reduceMovingTradeLine(
  state: Extract<DrawingState, { kind: 'moving-trade-line' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    return { ...state, preview: event.payload.point.price }
  }
  if (event.type === 'mouse-up') {
    if (ctx.updateTradeLine && state.preview !== state.original) {
      void ctx.updateTradeLine(state.handle, event.payload.point.price)
    }
    return idleState()
  }
  return state
}

function reduceMovingWaveLabel(
  state: Extract<DrawingState, { kind: 'moving-wave-label' }>,
  event: DrawingEvent,
  ctx: DispatchContext,
): DrawingState {
  if (event.type === 'mouse-move') {
    if (event.payload.point.time === null) return state
    const d = getWaveLabelData(state.original)
    if (!d) return state
    return {
      ...state,
      preview: {
        ...state.original,
        data: { ...d, t: event.payload.point.time, price: event.payload.point.price },
      },
    }
  }
  if (event.type === 'mouse-up') {
    if (event.payload.point.time !== null && state.preview !== state.original) {
      void ctx.updateDrawing(state.original.id, { data: state.preview.data })
    }
    return idleState()
  }
  return state
}
