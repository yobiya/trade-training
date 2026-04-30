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
  EMA20: {
    type: 'EMA20',
    label: 'EMA',
    defaultParams: { period: 20 },
    placement: 'overlay',
    defaultColor: '#87ceeb',  // 薄い青(light sky blue)
    compute: (bars, params) => calcEMA(bars, params.period),
  },
  EMA200: {
    type: 'EMA200',
    label: 'EMA',
    defaultParams: { period: 200 },
    placement: 'overlay',
    defaultColor: '#f0883e',  // オレンジ
    defaultWidth: 2,           // 太線(長期トレンドの視認性確保)
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

/** タイプとフォーカス TF から既定パラメータの IndicatorConfig を生成する(§5.2.1) */
export function defaultIndicatorConfig(type: IndicatorType, timeframe: string): IndicatorConfig {
  const spec = INDICATORS[type]
  return {
    key: indicatorKey(type, spec.defaultParams, timeframe),
    type,
    params: spec.defaultParams,
    timeframe,
    color: spec.defaultColor,
    width: spec.defaultWidth ?? 1,
  }
}
