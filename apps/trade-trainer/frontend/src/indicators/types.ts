import type { OhlcBar } from '../api/client'

export type IndicatorType = 'SMA' | 'EMA20' | 'EMA200' | 'RSI'
// 拡張時: | 'MACD' | 'BB' | ...

export type IndicatorParams = { period: number }

export type IndicatorConfig = {
  /** 一意キー(type + params + timeframe の組から生成)。Chart が Series インスタンスの同一性を判別するのに使う */
  key: string
  type: IndicatorType
  params: IndicatorParams
  /** §5.2.1: 作成時のフォーカス TF。この TF のチャートにのみ描画される */
  timeframe: string
  color: string
  /** 線の太さ(lightweight-charts の LineWidth: 1-4)。未指定時は 1 */
  width?: 1 | 2 | 3 | 4
}

export type IndicatorPlacement = 'overlay' | 'subpanel'

/** インジケーターの値(描画用) */
export type IndicatorPoint = { time: number; value: number }

export type IndicatorSpec = {
  type: IndicatorType
  label: string
  defaultParams: IndicatorParams
  /** overlay: ローソク足と同じ価格軸に重ねる / subpanel: サブペインに別スケールで表示 */
  placement: IndicatorPlacement
  defaultColor: string
  /** 既定の線の太さ(未指定時は 1) */
  defaultWidth?: 1 | 2 | 3 | 4
  /** OHLC から描画用の系列を計算する */
  compute(bars: OhlcBar[], params: IndicatorParams): IndicatorPoint[]
}

export function indicatorKey(type: IndicatorType, params: IndicatorParams, timeframe: string): string {
  return `${type}-${params.period}-${timeframe}`
}
