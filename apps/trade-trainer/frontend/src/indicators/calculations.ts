import type { OhlcBar } from '../api/client'
import type { IndicatorPoint } from './types'

/**
 * 単純移動平均(SMA)。直近 period 本の終値平均。
 */
export function calcSMA(bars: OhlcBar[], period: number): IndicatorPoint[] {
  if (period <= 0 || bars.length < period) return []
  const out: IndicatorPoint[] = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].c
    if (i >= period) sum -= bars[i - period].c
    if (i >= period - 1) {
      out.push({ time: bars[i].t, value: sum / period })
    }
  }
  return out
}

/**
 * 指数移動平均(EMA)。係数 k = 2/(N+1)、初期値は先頭 period 本の SMA。
 */
export function calcEMA(bars: OhlcBar[], period: number): IndicatorPoint[] {
  if (period <= 0 || bars.length < period) return []
  const out: IndicatorPoint[] = []
  const k = 2 / (period + 1)
  // シード: 先頭 period 本の SMA
  let seed = 0
  for (let i = 0; i < period; i++) seed += bars[i].c
  let ema = seed / period
  out.push({ time: bars[period - 1].t, value: ema })
  for (let i = period; i < bars.length; i++) {
    ema = bars[i].c * k + ema * (1 - k)
    out.push({ time: bars[i].t, value: ema })
  }
  return out
}

/**
 * RSI (Wilder 方式)。初回 period の平均上昇・下降から RS を算出。
 * 以降は平均値を period-1 : 1 で加重再帰。
 */
export function calcRSI(bars: OhlcBar[], period: number): IndicatorPoint[] {
  if (period <= 0 || bars.length < period + 1) return []
  const out: IndicatorPoint[] = []
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = bars[i].c - bars[i - 1].c
    if (change > 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= period
  avgLoss /= period
  const pushRsi = (idx: number) => {
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    out.push({ time: bars[idx].t, value: rsi })
  }
  pushRsi(period)
  for (let i = period + 1; i < bars.length; i++) {
    const change = bars[i].c - bars[i - 1].c
    const gain = change > 0 ? change : 0
    const loss = change < 0 ? -change : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    pushRsi(i)
  }
  return out
}
