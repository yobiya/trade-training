import { calcEMA, calcRSI, calcSMA } from './calculations'
import type { IndicatorConfig, IndicatorSpec, IndicatorType } from './types'
import { indicatorKey } from './types'

/**
 * インジケーター仕様のレジストリ(仕様書 §5.2)。
 * 新インジ追加時はここにエントリを足し、IndicatorType を types.ts に追加する。
 */
export const INDICATORS: Record<IndicatorType, IndicatorSpec> = {
  SMA: {
    type: 'SMA',
    label: 'SMA',
    defaultParams: { period: 20 },
    placement: 'overlay',
    defaultColor: '#58a6ff',
    compute: (bars, params) => calcSMA(bars, params.period),
  },
  EMA: {
    type: 'EMA',
    label: 'EMA',
    defaultParams: { period: 50 },
    placement: 'overlay',
    defaultColor: '#e3b341',
    compute: (bars, params) => calcEMA(bars, params.period),
  },
  RSI: {
    type: 'RSI',
    label: 'RSI',
    defaultParams: { period: 14 },
    placement: 'subpanel',
    defaultColor: '#d2a8ff',
    compute: (bars, params) => calcRSI(bars, params.period),
  },
}

/** タイプから既定パラメータの IndicatorConfig を生成する */
export function defaultIndicatorConfig(type: IndicatorType): IndicatorConfig {
  const spec = INDICATORS[type]
  return {
    key: indicatorKey(type, spec.defaultParams),
    type,
    params: spec.defaultParams,
    color: spec.defaultColor,
  }
}
