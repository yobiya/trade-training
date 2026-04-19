import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing, DrawingKind } from '../api/types'
import { IdleMode, toolStartMode } from '../drawing/modes'
import type {
  ChartApi,
  CreateDrawingBody,
  DrawingMode,
  ModeContext,
  PointPx,
  UpdateDrawingPatch,
} from '../drawing/types'

type Params = {
  drawings: Drawing[]
  activeTimeframe: string
  chartApiRef: React.RefObject<ChartApi | null>
  onCreate: (body: CreateDrawingBody) => Promise<Drawing>
  onUpdate: (id: number, patch: UpdateDrawingPatch) => Promise<void>
  onDelete: (id: number) => Promise<void>
}

export type DrawingInteraction = {
  cursor: string
  preview: Drawing | null
  /** 現在アクティブな作成ツール(Drawing*Mode 中のみ非 null)。ボタンのハイライトに使う。 */
  activeTool: DrawingKind | null
  /** ツールボタンから呼ぶ。null で Idle に戻る。 */
  selectTool: (tool: DrawingKind | null) => void
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
 * 描画ツールの対話状態を管理する。現在のモードにイベントを委譲するだけで、
 * 分岐ロジックを持たない(分岐は各モードクラス側が担う)。
 *
 * 詳細: docs/architecture/drawing-tools.md
 */
export function useDrawingInteraction({
  drawings, activeTimeframe, chartApiRef,
  onCreate, onUpdate, onDelete,
}: Params): DrawingInteraction {
  const [mode, setModeState] = useState<DrawingMode>(() => new IdleMode())
  const modeRef = useRef<DrawingMode>(mode)
  useEffect(() => { modeRef.current = mode }, [mode])

  // 画面再描画のトリガにする dummy state(preview / cursor の更新用)
  const [, setTick] = useState(0)
  const bump = useCallback(() => setTick(t => t + 1), [])

  // 最新の drawings / activeTimeframe を参照し続けるための ref
  const drawingsRef = useRef(drawings)
  useEffect(() => { drawingsRef.current = drawings }, [drawings])
  const tfRef = useRef(activeTimeframe)
  useEffect(() => { tfRef.current = activeTimeframe }, [activeTimeframe])

  const ctx = useMemo<ModeContext>(() => {
    const c: ModeContext = {
      get chartApi() { return chartApiRef.current ?? noopChartApi },
      get drawings() { return drawingsRef.current },
      get activeTimeframe() { return tfRef.current },
      setMode(next) {
        modeRef.current.onExit?.(c)
        next.onEnter?.(c)
        modeRef.current = next
        setModeState(next)
      },
      createDrawing: onCreate,
      updateDrawing: onUpdate,
      deleteDrawing: onDelete,
    }
    return c
  }, [chartApiRef, onCreate, onUpdate, onDelete])

  const selectTool = useCallback((tool: DrawingKind | null) => {
    ctx.setMode(toolStartMode(tool))
  }, [ctx])

  // ESC でキャンセル(モードに委譲)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        modeRef.current.onEscape?.(ctx)
        bump()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctx, bump])

  const handlers = useMemo(() => ({
    onChartClick: (price: number, time: number | null, px: PointPx) => {
      modeRef.current.onChartClick?.({ point: { price, time }, pointerPx: px }, ctx)
      bump()
    },
    onMouseMove: (price: number | null, time: number | null, px: PointPx) => {
      if (price === null) return
      modeRef.current.onMouseMove?.({ point: { price, time }, pointerPx: px }, ctx)
      bump()
    },
    onMouseDown: (price: number | null, time: number | null, px: PointPx) => {
      modeRef.current.onMouseDown?.({ point: { price: price ?? NaN, time }, pointerPx: px }, ctx)
      bump()
    },
    onMouseUp: (price: number | null, time: number | null, px: PointPx) => {
      modeRef.current.onMouseUp?.({ point: { price: price ?? NaN, time }, pointerPx: px }, ctx)
      bump()
    },
    onEscape: () => {
      modeRef.current.onEscape?.(ctx)
      bump()
    },
  }), [ctx, chartApiRef, bump])

  return {
    cursor: mode.cursor ?? 'default',
    preview: mode.getPreview?.() ?? null,
    activeTool: getActiveTool(mode),
    selectTool,
    handlers,
  }
}

function getActiveTool(mode: DrawingMode): DrawingKind | null {
  switch (mode.id) {
    case 'drawing-line': return 'line'
    case 'drawing-trendline': return 'trendline'
    case 'drawing-fibonacci': return 'fibonacci'
    default: return null
  }
}

const noopChartApi: ChartApi = {
  priceToY: () => null,
  yToPrice: () => null,
  timeToX: () => null,
  xToTime: () => null,
  setScrollEnabled: () => {},
}
