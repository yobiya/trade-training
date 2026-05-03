import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts'
import type {
  IChartApi,
  IPriceLine,
  ISeriesApi,
  CandlestickData,
  Logical,
  LogicalRange,
  MouseEventParams,
  SeriesMarker,
  Time,
} from 'lightweight-charts'
import type { OhlcBar } from '../api/client'
import { DEFAULT_VISIBLE_BARS, TIMEFRAME_MINUTES } from '../constants'
import type { ChartApi, PointPx } from '../drawing/types'
import { INDICATORS } from '../indicators/registry'
import type { IndicatorConfig } from '../indicators/types'

export type PriceLine = {
  id: string | number
  price: number
  label?: string
  color?: string
}

/** §5.5.4 エントリー / 決済の縦マーカー(エントリー TF のみ表示)。 */
export type ChartMarker = {
  /** バー時刻に丸めた Unix 秒(`SeriesMarker.time` が要求する) */
  time: number
  position: 'aboveBar' | 'belowBar'
  shape: 'arrowUp' | 'arrowDown'
  color: string
  text?: string
}

export type ChartHandle = {
  api: ChartApi
  containerEl: HTMLDivElement | null
  /** チャートの再描画が必要なタイミング(時間軸変化・リサイズ等)でコールバックを呼ぶ。 */
  subscribeRedraw: (cb: () => void) => () => void
  /**
   * §11.3.1 AI 分析向けにチャートのスクリーンショットを PNG dataURL で返す。
   * lightweight-charts の `takeScreenshot()` で得られる Canvas を toDataURL する。
   * 描画オーバーレイ(SVG)・マーカー焼き込みは MVP では含めない(描画情報は payload メタに入る)。
   */
  takeScreenshot: () => string | null
  /**
   * §5.1.2 クロスヘア同期(命令的): 他チャートからの時刻を受け取り setCrosshairPosition を呼ぶ。
   * null でクリア。bars に存在しない time は最寄りバーへスナップ。
   */
  setCrosshairTime: (time: number | null) => void
  /**
   * §5.1.2 クロスヘア同期(購読): ユーザー操作によるクロスヘア移動のみを通知する。
   * `setCrosshairTime` で発火した programmatic な move は通知しない(feedback ループ防止)。
   */
  subscribeUserCrosshair: (cb: (time: number | null) => void) => () => void
  /**
   * §5.1.6 LowerTfRangeOverlay 用: 自 Chart の visible logical range を返す。
   * `timeScale.getVisibleLogicalRange()` の薄いラッパ。`from <= 0` で過去 whitespace、
   * `to >= bars.length - 1` で右側 rightOffset whitespace に到達している判定に使う。
   * 詳細は frontend-chart.md §5.3 / invariants.md I-12。
   */
  getVisibleLogicalRange: () => { from: number; to: number } | null
}

type Props = {
  bars: OhlcBar[]
  timeframe: string
  /** §5.1.3 (ver 1.72): 銘柄。symbol が変わったら setData + width preserve + 右端揃えで再 set する */
  symbol: string
  cursor?: string
  /** 価格表示の小数桁数(MT5 symbol_info.digits)。 */
  digits?: number
  /** チャートの可視範囲が左端に近づいた際の遅延ロード(loadMoreHistory)。最古バーの timestamp(秒)が渡る。 */
  onNeedMoreHistory?: (earliestUnix: number) => void
  /** クリック / マウス移動 / 押下 / 離上 の薄い中継。座標変換済みの Point を渡す。 */
  onChartClick?: (price: number, time: number | null, px: PointPx) => void
  onMouseMove?: (price: number | null, time: number | null, px: PointPx) => void
  onMouseDown?: (price: number | null, time: number | null, px: PointPx) => void
  onMouseUp?: (price: number | null, time: number | null, px: PointPx) => void
  /** チャートに重ねて表示する価格線。 */
  priceLines?: PriceLine[]
  /** §5.5.4 エントリー / 決済のマーカー(エントリー TF のチャートにのみ渡す)。 */
  markers?: ChartMarker[]
  /** チャートに重ねて表示するインジケーター。 */
  indicators?: IndicatorConfig[]
}

const RSI_SCALE_ID = 'rsi-pane'

function toCandle(bar: OhlcBar): CandlestickData {
  return { time: bar.t as Time, open: bar.o, high: bar.h, low: bar.l, close: bar.c }
}

/** 可視範囲の `range.from` がこの値より小さくなったら追加 history を要求する。 */
const LOAD_MORE_THRESHOLD = 5
/** lightweight-charts の `timeScale.options.rightOffset` と同値(右端余白のバー幅)。 */
const RIGHT_OFFSET = 4

/**
 * §5.1.3: 指定 width で右端揃えの visible logical range を適用する。
 * バー数が width 未満の TF(broker ヒストリ不足等)では `fitContent()` でフォールバック。
 */
function applyVisibleRange(chart: IChartApi, barsLength: number, width: number): void {
  if (barsLength <= 0) return
  if (barsLength < width) {
    chart.timeScale().fitContent()
    return
  }
  const to = barsLength - 1 + RIGHT_OFFSET
  const from = to - width
  chart.timeScale().setVisibleLogicalRange({ from, to })
}

/**
 * 純粋なチャート描画コンポーネント。ツール固有のロジックは持たない。
 * - ろうそく足 + priceLines をレンダ
 * - クリック・マウス移動・押下・離上 を上位へ中継
 * - 座標変換 API を ref 経由で公開
 */
export const Chart = forwardRef<ChartHandle, Props>(function Chart({
  bars, timeframe, symbol, cursor, digits, onNeedMoreHistory,
  onChartClick, onMouseMove, onMouseDown, onMouseUp,
  priceLines, markers, indicators,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  /** 「初回データ反映 = fitContent 必要」のフラグ。timeframe 変化時に null へリセットされる。 */
  const fittedForTfRef = useRef<string | null>(null)
  const onNeedMoreRef = useRef(onNeedMoreHistory)
  const onChartClickRef = useRef(onChartClick)
  const onMouseMoveRef = useRef(onMouseMove)
  const onMouseDownRef = useRef(onMouseDown)
  const onMouseUpRef = useRef(onMouseUp)
  const priceLineHandlesRef = useRef<Map<string | number, IPriceLine>>(new Map())
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const rsiPaneConfiguredRef = useRef(false)
  /** クロスヘア同期: 最新の bars を保持(setCrosshairTime から近接バー検索に使う) */
  const barsRef = useRef<OhlcBar[]>(bars)
  /** クロスヘア同期: ユーザー操作だけを通知する subscriber 集合 */
  const userCrosshairSubsRef = useRef<Set<(t: number | null) => void>>(new Set())
  /** §5.1.3: pxToTime / timeToPx 等の helper から現在の TF を参照するための ref */
  const tfRef = useRef<string>(timeframe)
  /** §5.1.3 (ver 1.72): 銘柄切替検知用。null の間は「まだ symbol を見ていない」状態 */
  const prevSymbolRef = useRef<string | null>(null)

  useEffect(() => { onNeedMoreRef.current = onNeedMoreHistory }, [onNeedMoreHistory])
  useEffect(() => { onChartClickRef.current = onChartClick }, [onChartClick])
  useEffect(() => { onMouseMoveRef.current = onMouseMove }, [onMouseMove])
  useEffect(() => { onMouseDownRef.current = onMouseDown }, [onMouseDown])
  useEffect(() => { onMouseUpRef.current = onMouseUp }, [onMouseUp])
  useEffect(() => { tfRef.current = timeframe }, [timeframe])

  /**
   * §5.3: バー範囲外(右余白・左余白)のクリック / マウス位置でも描画ができるよう、
   * `coordinateToTime` が null を返す位置では `coordinateToLogical` + TF 間隔で線形外挿する。
   * 返り値はバーが存在する範囲ならライブラリ値、それ以外は外挿値(Unix 秒)。
   */
  function pxToTime(pxX: number): number | null {
    const chart = chartRef.current
    if (!chart) return null
    const ts = chart.timeScale()
    const logical = ts.coordinateToLogical(pxX)
    if (logical == null) return null
    const bars = barsRef.current
    if (bars.length === 0) return null
    const lastIdx = bars.length - 1
    if (logical >= 0 && logical <= lastIdx) {
      const t = ts.coordinateToTime(pxX)
      return typeof t === 'number' ? t : null
    }
    const tfSec = (TIMEFRAME_MINUTES[tfRef.current] ?? 5) * 60
    if (logical > lastIdx) {
      return Math.floor(bars[lastIdx].t + (logical - lastIdx) * tfSec)
    }
    return Math.floor(bars[0].t + logical * tfSec)
  }

  /**
   * §5.3: バー範囲外の時刻を持つ描画(トレンドラインの未来側端点等)が消えないよう、
   * `timeToCoordinate` が null を返す時刻では TF 間隔換算の論理 index 経由で x を求める。
   */
  function timeToPx(time: number): number | null {
    const chart = chartRef.current
    if (!chart) return null
    const ts = chart.timeScale()
    const x = ts.timeToCoordinate(time as Time)
    if (x !== null) return x
    const bars = barsRef.current
    if (bars.length === 0) return null
    const tfSec = (TIMEFRAME_MINUTES[tfRef.current] ?? 5) * 60
    const lastIdx = bars.length - 1
    let logical: number
    if (time > bars[lastIdx].t) {
      logical = lastIdx + (time - bars[lastIdx].t) / tfSec
    } else if (time < bars[0].t) {
      logical = (time - bars[0].t) / tfSec
    } else {
      return null
    }
    return ts.logicalToCoordinate(logical as Logical) ?? null
  }

  useImperativeHandle(ref, () => ({
    get api(): ChartApi {
      return {
        priceToY: (price: number) => seriesRef.current?.priceToCoordinate(price) ?? null,
        yToPrice: (y: number) => {
          const p = seriesRef.current?.coordinateToPrice(y)
          return typeof p === 'number' ? p : null
        },
        timeToX: (time: number) => timeToPx(time),
        xToTime: (x: number) => pxToTime(x),
        logicalToX: (logical: number) => {
          const ts = chartRef.current?.timeScale()
          if (!ts) return null
          const x = ts.logicalToCoordinate(logical as Logical)
          return x ?? null
        },
        setScrollEnabled: (enabled: boolean) => {
          chartRef.current?.applyOptions({
            handleScroll: { pressedMouseMove: enabled, horzTouchDrag: enabled, vertTouchDrag: enabled },
            handleScale: { axisPressedMouseMove: enabled },
          })
        },
      }
    },
    get containerEl() { return containerRef.current },
    subscribeRedraw(cb: () => void) {
      const chart = chartRef.current
      const container = containerRef.current
      if (!chart || !container) return () => {}
      const handler = () => cb()
      chart.timeScale().subscribeVisibleLogicalRangeChange(handler)
      const ro = new ResizeObserver(() => cb())
      ro.observe(container)
      return () => {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handler)
        ro.disconnect()
      }
    },
    takeScreenshot() {
      const chart = chartRef.current
      if (!chart) return null
      try {
        const canvas = chart.takeScreenshot()
        return canvas.toDataURL('image/png')
      } catch {
        return null
      }
    },
    setCrosshairTime(time: number | null) {
      const chart = chartRef.current
      const series = seriesRef.current
      if (!chart || !series) return
      if (time == null) {
        chart.clearCrosshairPosition()
        return
      }
      const currentBars = barsRef.current
      if (currentBars.length === 0) return
      // bars はソート済(by t)。time 以下の最大 bar(or 最寄りの bar)を線形検索
      let nearest: OhlcBar | null = null
      for (const b of currentBars) {
        if (b.t > time) break
        nearest = b
      }
      if (!nearest) nearest = currentBars[0]
      try {
        chart.setCrosshairPosition(nearest.c, nearest.t as Time, series)
      } catch {
        // series に該当 time が無い等で失敗してもクラッシュさせない
      }
    },
    subscribeUserCrosshair(cb: (time: number | null) => void) {
      userCrosshairSubsRef.current.add(cb)
      return () => {
        userCrosshairSubsRef.current.delete(cb)
      }
    },
    getVisibleLogicalRange() {
      const range = chartRef.current?.timeScale().getVisibleLogicalRange()
      if (!range) return null
      return { from: range.from, to: range.to }
    },
  }), [])

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
      grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 4 },
      // ローソク足の上下余白(lightweight-charts 既定の半分: top 0.2→0.1, bottom 0.1→0.05)
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.05 } },
      // 仕様書 §5.1.3: 素のホイール = ページスクロール、Ctrl+ホイール = ズーム
      // ライブラリ標準のホイールズームを無効化し、自前の wheel ハンドラで分岐する
      handleScale: { mouseWheel: false },
      // クロスヘアをカーソル位置に追従させる(既定の Magnet は直近バー close にスナップする)
      crosshair: { mode: CrosshairMode.Normal },
    })
    const series = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    chartRef.current = chart
    seriesRef.current = series

    // §playwright-testing-improvements 案 B: DEV 環境限定で座標変換 API を window に露出する。
    // Playwright テストが 1 行で y 座標を取得できるようにするためのフック。
    // production ビルドでは import.meta.env.DEV が false になりツリーシェイクで除去される。
    if (import.meta.env.DEV) {
      type ChartTestEntry = {
        priceToY(p: number): number | null
        yToPrice(y: number): number | null
        timeToX(t: number): number | null
        xToTime(x: number): number | null
      }
      const w = window as unknown as { __chartTest?: Map<string, ChartTestEntry> }
      w.__chartTest ??= new Map()
      w.__chartTest.set(timeframe, {
        priceToY: (p) => seriesRef.current?.priceToCoordinate(p) ?? null,
        yToPrice: (y) => {
          const v = seriesRef.current?.coordinateToPrice(y)
          return typeof v === 'number' ? v : null
        },
        timeToX: (t) => timeToPx(t),
        xToTime: (x) => pxToTime(x),
      })
    }

    // 可視範囲が左端付近に近づいたら追加 history を要求(loadMoreHistory)。
    // logical range の `from` がデータ先頭バー(index=0)に近づくと負値になるので、
    // 一定閾値より下回ったタイミングで onNeedMoreHistory を呼ぶ。
    // ※ §5.1.3 (ver 1.72): rangeHandler はもう memory への書込を行わない。
    //   過去 ver では setVisibleWidth で TF 別 width を保存していたが、
    //   lightweight-charts が setData 直後に発火する自動 emit で memory が
    //   汚染されるバグの温床だったため撤廃。width は Chart instance 内に閉じる。
    const rangeHandler = (range: LogicalRange | null) => {
      if (!range) return
      if (range.from < LOAD_MORE_THRESHOLD) {
        const oldest = barsRef.current[0]
        if (oldest) onNeedMoreRef.current?.(oldest.t)
      }
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(rangeHandler)

    const clickHandler = (param: MouseEventParams) => {
      if (!param.point || !seriesRef.current) return
      const price = seriesRef.current.coordinateToPrice(param.point.y)
      if (price == null) return
      // §5.3: バー範囲外でも描画できるよう、param.time が無い場合は外挿で時刻を求める
      const time = typeof param.time === 'number' ? param.time : pxToTime(param.point.x)
      onChartClickRef.current?.(price, time, { x: param.point.x, y: param.point.y })
    }
    chart.subscribeClick(clickHandler)

    // §5.1.2 クロスヘア同期: ユーザー操作による crosshair 移動を購読者に通知。
    // sourceEvent が undefined の呼び出し(= setCrosshairPosition による programmatic)はスキップ
    // してフィードバックループを防ぐ。
    const crosshairHandler = (param: MouseEventParams) => {
      if (param.sourceEvent === undefined) return
      const t = typeof param.time === 'number' ? param.time : null
      for (const cb of userCrosshairSubsRef.current) cb(t)
    }
    chart.subscribeCrosshairMove(crosshairHandler)

    // ネイティブ DOM イベントは上位(hook)へ中継
    const container = containerRef.current
    const toPx = (e: MouseEvent): PointPx => {
      const rect = container.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const mmHandler = (e: MouseEvent) => {
      const px = toPx(e)
      const price = seriesRef.current ? seriesRef.current.coordinateToPrice(px.y) : null
      const time = pxToTime(px.x)
      onMouseMoveRef.current?.(typeof price === 'number' ? price : null, time, px)
    }
    const convert = (px: PointPx): { price: number | null; time: number | null } => {
      const rawPrice = seriesRef.current?.coordinateToPrice(px.y)
      const price = typeof rawPrice === 'number' ? rawPrice : null
      return { price, time: pxToTime(px.x) }
    }
    const mdHandler = (e: MouseEvent) => {
      if (e.button !== 0) return
      const px = toPx(e)
      const { price, time } = convert(px)
      onMouseDownRef.current?.(price, time, px)
    }
    const muHandler = (e: MouseEvent) => {
      if (e.button !== 0) return
      const px = toPx(e)
      const { price, time } = convert(px)
      onMouseUpRef.current?.(price, time, px)
    }
    container.addEventListener('mousemove', mmHandler)
    container.addEventListener('mousedown', mdHandler, true)
    window.addEventListener('mouseup', muHandler)

    // 仕様書 §5.1.3: Ctrl+ホイール = 時間軸ズーム、素のホイール = ページスクロール
    // マウス位置の logical 座標を中心にしてズームする(Figma/Google Maps 等に揃える)。
    const ZOOM_FACTOR = 1.1
    const wheelHandler = (e: WheelEvent) => {
      if (!e.ctrlKey) return  // 素のホイールはバブルしてページスクロールに委ねる
      e.preventDefault()
      const ts = chartRef.current?.timeScale()
      if (!ts) return
      const range = ts.getVisibleLogicalRange()
      if (!range) return
      const px = toPx(e as unknown as MouseEvent)
      const centerLogical = ts.coordinateToLogical(px.x)
      if (centerLogical == null) return
      const width = range.to - range.from
      const scale = e.deltaY > 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR
      const newWidth = width * scale
      const ratio = (centerLogical - range.from) / width
      const newFrom = centerLogical - newWidth * ratio
      const newTo = newFrom + newWidth
      ts.setVisibleLogicalRange({ from: newFrom, to: newTo })
    }
    // passive: false にしないと preventDefault できない
    container.addEventListener('wheel', wheelHandler, { passive: false })

    return () => {
      if (import.meta.env.DEV) {
        (window as unknown as { __chartTest?: Map<string, unknown> }).__chartTest?.delete(timeframe)
      }
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(rangeHandler)
      chart.unsubscribeClick(clickHandler)
      chart.unsubscribeCrosshairMove(crosshairHandler)
      container.removeEventListener('mousemove', mmHandler)
      container.removeEventListener('mousedown', mdHandler, true)
      container.removeEventListener('wheel', wheelHandler)
      window.removeEventListener('mouseup', muHandler)
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      fittedForTfRef.current = null
      prevSymbolRef.current = null
      priceLineHandlesRef.current.clear()
      indicatorSeriesRef.current.clear()
      rsiPaneConfiguredRef.current = false
    }
  }, [])

  // [描画] §5.1.3 (ver 1.72): Chart instance は TF ごとに 1 つ永続化される。
  // - 初回 mount: 既定 width で右端揃え
  // - symbol 変化: 直前の visible range の width を保持 → setData → 新 bars の右端に揃えて再 set
  // - 同 symbol の bars 変化(advance / loadMoreHistory): visible range は触らない(LWC が保持)
  useEffect(() => {
    const series = seriesRef.current
    const chart = chartRef.current
    barsRef.current = bars
    if (!series || !chart || bars.length === 0) return

    const isFirstMountForTf = fittedForTfRef.current !== timeframe
    const symbolChanged =
      !isFirstMountForTf
      && prevSymbolRef.current !== null
      && prevSymbolRef.current !== symbol

    // symbol 変化時、setData 前に width を取得しておく(setData 後は LWC が visible range を
    // 保持するが、その値を使って新 bars の右端に揃え直す必要があるため事前に控える)
    let preservedWidth: number | null = null
    if (symbolChanged) {
      const r = chart.timeScale().getVisibleLogicalRange()
      if (r) preservedWidth = r.to - r.from
    }

    series.setData(bars.map(toCandle))

    if (isFirstMountForTf) {
      applyVisibleRange(chart, bars.length, DEFAULT_VISIBLE_BARS)
      fittedForTfRef.current = timeframe
    } else if (symbolChanged && preservedWidth != null) {
      applyVisibleRange(chart, bars.length, preservedWidth)
    }
    // 同 symbol の bars 変化: 何もしない(LWC が visible range を維持する)

    prevSymbolRef.current = symbol
  }, [bars, timeframe, symbol])

  // 価格スケール・priceLine ラベルの精度を digits に合わせる
  useEffect(() => {
    if (!seriesRef.current || digits == null) return
    seriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision: digits,
        minMove: Math.pow(10, -digits),
      },
    })
  }, [digits])

  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const handles = priceLineHandlesRef.current
    const nextIds = new Set(priceLines?.map(pl => pl.id) ?? [])

    for (const [id, handle] of handles) {
      if (!nextIds.has(id)) {
        series.removePriceLine(handle)
        handles.delete(id)
      }
    }
    for (const pl of priceLines ?? []) {
      const existing = handles.get(pl.id)
      if (existing) {
        existing.applyOptions({ price: pl.price, title: pl.label ?? '', color: pl.color ?? '#58a6ff' })
      } else {
        const h = series.createPriceLine({
          price: pl.price,
          color: pl.color ?? '#58a6ff',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: pl.label ?? '',
        })
        handles.set(pl.id, h)
      }
    }
  }, [priceLines])

  // §5.5.4 マーカー: setMarkers([]) でクリア + 一括上書き(差分管理は不要)
  useEffect(() => {
    const series = seriesRef.current
    if (!series) return
    const next: SeriesMarker<Time>[] = (markers ?? []).map(m => ({
      time: m.time as Time,
      position: m.position,
      shape: m.shape,
      color: m.color,
      text: m.text,
    }))
    series.setMarkers(next)
  }, [markers])

  // インジケーターの差分更新(仕様書 §5.2)。
  // - overlay: ローソク足と同じ右側価格軸に重ねる
  // - subpanel: RSI_SCALE_ID で別スケールを作り、下 25% に表示
  //
  // lightweight-charts v4 の priceScale はいずれかの系列が参照したときに生成されるため、
  // 順序は「系列追加/更新 → スケール設定」の順に行う必要がある。
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const seriesMap = indicatorSeriesRef.current
    const next = indicators ?? []
    const nextKeys = new Set(next.map(i => i.key))

    // 廃止されたインジケーターの series を削除
    for (const [key, s] of seriesMap) {
      if (!nextKeys.has(key)) {
        chart.removeSeries(s)
        seriesMap.delete(key)
      }
    }

    // 追加・更新
    for (const ind of next) {
      const spec = INDICATORS[ind.type]
      if (!spec) continue  // 旧バージョンの type が state に残っている場合の防御
      const data = spec.compute(bars, ind.params).map(p => ({
        time: p.time as Time,
        value: p.value,
      }))
      const lineWidth = ind.width ?? 1
      let s = seriesMap.get(ind.key)
      if (!s) {
        s = chart.addLineSeries({
          color: ind.color,
          lineWidth,
          priceScaleId: spec.placement === 'subpanel' ? RSI_SCALE_ID : 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        })
        seriesMap.set(ind.key, s)
      } else {
        s.applyOptions({ color: ind.color, lineWidth })
      }
      s.setData(data)
    }

    // 系列追加後にスケールのマージンを構成する(サブパネル領域の確保)
    const hasSubpanel = next.some(i => INDICATORS[i.type]?.placement === 'subpanel')
    if (hasSubpanel) {
      // RSI 用のスケール(系列追加後なので参照可能)
      chart.priceScale(RSI_SCALE_ID).applyOptions({
        scaleMargins: { top: 0.78, bottom: 0 },
        borderVisible: false,
      })
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.25 } })
      rsiPaneConfiguredRef.current = true
    } else if (rsiPaneConfiguredRef.current) {
      // RSI 解除時は createChart 既定値に戻す
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.05 } })
      rsiPaneConfiguredRef.current = false
    }
  }, [indicators, bars])

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', cursor: cursor ?? 'default' }}
    />
  )
})
