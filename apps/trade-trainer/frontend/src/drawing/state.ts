import type { Drawing, DrawingKind } from '../api/types'
import { lineTool } from './tools/line'
import { fibonacciTool, getFibPoints } from './tools/fibonacci'
import { findHit } from './tools/registry'
import { trendlineTool, getTrendlinePoints } from './tools/trendline'
import { waveLabelTool, getWaveLabelData } from './tools/wave_label'
import type {
  ChartApi,
  CreateDrawingBody,
  HitResult,
  PointerPayload,
  UpdateDrawingPatch,
} from './types'

/**
 * 描画ツールの状態管理(ver 1.55 で 11 クラス階層から tagged union + 単一 dispatch 関数に統合)。
 * 詳細: docs/architecture/drawing-tools.md
 */

type PP = { t: number; price: number }
type Wave = 1 | 2 | 3 | 4 | 5

export type DrawingState =
  | { kind: 'idle'; cursor: string; hoveredId: number | null }
  | { kind: 'drawing-line' }
  | { kind: 'drawing-trendline'; firstPoint: PP | null; currentPoint: PP | null }
  | { kind: 'drawing-fibonacci'; firstPoint: PP | null; currentPoint: PP | null }
  | { kind: 'drawing-wave-label'; wave: Wave; previewPoint: PP | null }
  | { kind: 'moving-line'; original: Drawing; preview: Drawing }
  | { kind: 'moving-trendline-handle'; original: Drawing; preview: Drawing; handleIndex: number }
  | { kind: 'moving-trendline-body'; original: Drawing; preview: Drawing; anchor: PP }
  | { kind: 'moving-fibonacci-handle'; original: Drawing; preview: Drawing; handleIndex: number }
  | { kind: 'moving-fibonacci-body'; original: Drawing; preview: Drawing; anchor: PP }
  | { kind: 'moving-wave-label'; original: Drawing; preview: Drawing }

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
    case 'drawing-trendline': return reduceDrawingTrendline(state, event, ctx)
    case 'drawing-fibonacci': return reduceDrawingFibonacci(state, event, ctx)
    case 'drawing-wave-label': return reduceDrawingWaveLabel(state, event, ctx)
    case 'moving-line': return reduceMovingLine(state, event, ctx)
    case 'moving-trendline-handle': return reduceMovingTrendlineHandle(state, event, ctx)
    case 'moving-trendline-body': return reduceMovingTrendlineBody(state, event, ctx)
    case 'moving-fibonacci-handle': return reduceMovingFibonacciHandle(state, event, ctx)
    case 'moving-fibonacci-body': return reduceMovingFibonacciBody(state, event, ctx)
    case 'moving-wave-label': return reduceMovingWaveLabel(state, event, ctx)
  }
}

// -----------------------------------------------------------------------------
// selectors
// -----------------------------------------------------------------------------

export function cursorOf(state: DrawingState): string {
  switch (state.kind) {
    case 'idle': return state.cursor
    case 'drawing-line':
    case 'drawing-trendline':
    case 'drawing-fibonacci':
    case 'drawing-wave-label': return 'crosshair'
    case 'moving-line': return 'ns-resize'
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

// -----------------------------------------------------------------------------
// helpers
// -----------------------------------------------------------------------------

function startToolState(tool: DrawingKind | null, wave?: Wave): DrawingState {
  if (tool === null) return idleState()
  switch (tool) {
    case 'line': return { kind: 'drawing-line' }
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
        anchor: { t: payload.point.time, price: payload.point.price },
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
        anchor: { t: payload.point.time, price: payload.point.price },
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
    const hit = findHit(ctx.drawings, event.payload.pointerPx, ctx.chartApi)
    return {
      kind: 'idle',
      cursor: hit ? cursorForHit(hit) : 'default',
      hoveredId: hit?.drawingId ?? null,
    }
  }
  if (event.type === 'mouse-down') {
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
    return idleState()
  }
  if (event.type === 'mouse-move' && event.payload.point.time !== null) {
    return {
      ...state,
      previewPoint: { t: event.payload.point.time, price: event.payload.point.price },
    }
  }
  return state
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
    if (event.payload.point.time === null) return state
    const dt = event.payload.point.time - state.anchor.t
    const dp = event.payload.point.price - state.anchor.price
    const orig = getTrendlinePoints(state.original)
    if (!orig) return state
    return {
      ...state,
      preview: {
        ...state.original,
        data: { points: orig.map(p => ({ t: p.t + dt, price: p.price + dp })) },
      },
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
    if (event.payload.point.time === null) return state
    const dt = event.payload.point.time - state.anchor.t
    const dp = event.payload.point.price - state.anchor.price
    const orig = getFibPoints(state.original)
    if (!orig) return state
    return {
      ...state,
      preview: {
        ...state.original,
        data: { points: orig.map(p => ({ t: p.t + dt, price: p.price + dp })) },
      },
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
