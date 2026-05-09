import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing, DrawingKind } from '../api/types'
import {
  activeToolOf,
  activeWaveOf,
  cursorOf,
  dispatchEvent,
  hoveredIdOf,
  idleState,
  isMovingState,
  previewOf,
  tradeLinePreviewOf,
  type DispatchContext,
  type DrawingEvent,
  type DrawingState,
  type TradeLineHandle,
  type TradeLinesSnapshot,
} from '../drawing/state'
import type {
  ChartApi,
  CreateDrawingBody,
  PointPx,
  UpdateDrawingPatch,
} from '../drawing/types'
import { isWaveValue, type WaveValue } from '../drawing/tools/wave_label'

type Params = {
  drawings: Drawing[]
  activeTimeframe: string
  chartApiRef: React.RefObject<ChartApi | null>
  onCreate: (body: CreateDrawingBody) => Promise<Drawing>
  onUpdate: (id: number, patch: UpdateDrawingPatch) => Promise<void>
  onDelete: (id: number) => Promise<void>
  /** §5.5.5 SL/TP の drag 移動。null = drag 不可(分析中・振り返り・無トレード) */
  tradeLines?: TradeLinesSnapshot | null
  /** §5.5.5 SL/TP drag 確定時の commit。`tradeLines` 非 null + これがあるときのみ drag 可 */
  onUpdateTradeLine?: (handle: TradeLineHandle, price: number) => Promise<void>
}

export type DrawingInteraction = {
  cursor: string
  preview: Drawing | null
  /** ホバー中の描画 ID(§5.3 TF バッジ表示用) */
  hoveredId: number | null
  /** 現在アクティブな作成ツール(drawing-* 状態のみ非 null)。ボタンのハイライトに使う。 */
  activeTool: DrawingKind | null
  /** 波動ラベル配置中の波番号(wave_label ツール選択時のみ非 null)。1-5 推進波 + A/B/C 補正波。 */
  activeWave: WaveValue | null
  /** §5.5.5 SL/TP drag 中の preview 値。SessionPage が priceLine 描画で元値を上書きする */
  tradeLinePreview: { handle: TradeLineHandle; price: number } | null
  /** ツールボタンから呼ぶ。null で Idle に戻る。wave_label の場合は wave 番号必須。 */
  selectTool: (tool: DrawingKind | null, wave?: WaveValue) => void
  /** Chart に繋ぐイベント中継 */
  handlers: {
    onChartClick: (price: number, time: number | null, px: PointPx) => void
    onMouseMove: (price: number | null, time: number | null, px: PointPx) => void
    onMouseDown: (price: number | null, time: number | null, px: PointPx) => void
    onMouseUp: (price: number | null, time: number | null, px: PointPx) => void
    onEscape: () => void
  }
}

/**
 * 描画ツールの対話状態を管理する。`drawing/state.ts` の `dispatchEvent` に
 * イベントを委譲するだけで、分岐ロジックを持たない(分岐は state 側 switch が担う)。
 *
 * 詳細: docs/architecture/drawing-tools.md
 */
export function useDrawingInteraction({
  drawings, activeTimeframe, chartApiRef,
  onCreate, onUpdate, onDelete,
  tradeLines = null, onUpdateTradeLine,
}: Params): DrawingInteraction {
  const [state, setState] = useState<DrawingState>(idleState)
  const stateRef = useRef<DrawingState>(state)

  // 最新の drawings / activeTimeframe / tradeLines を参照し続けるための ref
  const drawingsRef = useRef(drawings)
  useEffect(() => { drawingsRef.current = drawings }, [drawings])
  const tfRef = useRef(activeTimeframe)
  useEffect(() => { tfRef.current = activeTimeframe }, [activeTimeframe])
  const tradeLinesRef = useRef(tradeLines)
  useEffect(() => { tradeLinesRef.current = tradeLines }, [tradeLines])

  const ctx = useMemo<DispatchContext>(() => ({
    get chartApi() { return chartApiRef.current ?? noopChartApi },
    get drawings() { return drawingsRef.current },
    get activeTimeframe() { return tfRef.current },
    get tradeLines() { return tradeLinesRef.current },
    createDrawing: onCreate,
    updateDrawing: onUpdate,
    deleteDrawing: onDelete,
    updateTradeLine: onUpdateTradeLine,
  }), [chartApiRef, onCreate, onUpdate, onDelete, onUpdateTradeLine])

  const dispatch = useCallback((event: DrawingEvent) => {
    const prev = stateRef.current
    const next = dispatchEvent(prev, event, ctx)
    if (next === prev) return
    // moving-* 状態への出入りでチャートのドラッグパンを抑止する(描画操作と干渉させない)。
    const wasMoving = isMovingState(prev)
    const nowMoving = isMovingState(next)
    if (wasMoving !== nowMoving) {
      ctx.chartApi.setScrollEnabled(!nowMoving)
    }
    stateRef.current = next
    setState(next)
  }, [ctx])

  const selectTool = useCallback((tool: DrawingKind | null, wave?: WaveValue) => {
    dispatch({ type: 'select-tool', tool, wave })
  }, [dispatch])

  // §5.3 波動ラベル ホットキー + ESC キャンセル(状態に委譲)。
  // - `1`-`5` / `A`-`C`(`a`-`c` 小文字も許容)で波動ラベル配置モードへ直接遷移
  //   (state.ts の select-tool は現状態に関わらず drawing-wave-label に切替える)。
  // - 入力欄(input/textarea/contentEditable)フォーカス時はメモ入力を妨げないため捕捉しない。
  // - 修飾キー(Ctrl/Meta/Alt)同時押しは捕捉しない(ブラウザ標準ショートカットを尊重)。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dispatch({ type: 'escape' })
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }
      const candidate = e.key.toUpperCase()
      if (isWaveValue(candidate)) {
        e.preventDefault()
        dispatch({ type: 'select-tool', tool: 'wave_label', wave: candidate })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  const handlers = useMemo(() => ({
    onChartClick: (price: number, time: number | null, px: PointPx) => {
      dispatch({ type: 'click', payload: { point: { price, time }, pointerPx: px } })
    },
    onMouseMove: (price: number | null, time: number | null, px: PointPx) => {
      if (price === null) return
      dispatch({ type: 'mouse-move', payload: { point: { price, time }, pointerPx: px } })
    },
    onMouseDown: (price: number | null, time: number | null, px: PointPx) => {
      dispatch({ type: 'mouse-down', payload: { point: { price: price ?? NaN, time }, pointerPx: px } })
    },
    onMouseUp: (price: number | null, time: number | null, px: PointPx) => {
      dispatch({ type: 'mouse-up', payload: { point: { price: price ?? NaN, time }, pointerPx: px } })
    },
    onEscape: () => dispatch({ type: 'escape' }),
  }), [dispatch])

  return {
    cursor: cursorOf(state),
    preview: previewOf(state),
    hoveredId: hoveredIdOf(state),
    activeTool: activeToolOf(state),
    activeWave: activeWaveOf(state),
    tradeLinePreview: tradeLinePreviewOf(state),
    selectTool,
    handlers,
  }
}

const noopChartApi: ChartApi = {
  priceToY: () => null,
  yToPrice: () => null,
  timeToX: () => null,
  xToTime: () => null,
  logicalToX: () => null,
  setScrollEnabled: () => {},
  getBars: () => [],
}
