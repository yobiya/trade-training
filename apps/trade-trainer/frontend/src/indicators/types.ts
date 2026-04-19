import type { OhlcBar } from '../api/client'

export type IndicatorType = 'SMA' | 'EMA' | 'RSI'
// 拡張時: | 'MACD' | 'BB' | ...

export type IndicatorParams = { period: number }

export type IndicatorConfig = {
  /** 一意キー(type と params の組から生成)。Chart が Series インスタンスの同一性を判別するのに使う */
  key: string
  type: IndicatorType
  params: IndicatorParams
  color: string
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
  /** OHLC から描画用の系列を計算する */
  compute(bars: OhlcBar[], params: IndicatorParams): IndicatorPoint[]
}

export function indicatorKey(type: IndicatorType, params: IndicatorParams): string {
  return `${type}-${params.period}`
}
