import { useEffect, useState } from 'react'
import type { OhlcBar } from '../api/client'
import { getTimeframeColor } from '../constants'
import type { ChartHandle } from './Chart'

type Props = {
  /** 自 TF pane の ChartHandle(描画先 = 上位 TF 側) */
  upperHandle: ChartHandle | null
  /** 自 TF pane の bar 配列(time ↔ logical 変換テーブルとして使う) */
  upperBars: OhlcBar[]
  /** 自 TF の 1 バーの秒数(`TIMEFRAME_MINUTES * 60`) */
  upperTfSec: number
  /** 直下 TF pane の ChartHandle(可視レンジ取得元) */
  lowerHandle: ChartHandle | null
  /** 直下 TF pane の bar 配列 */
  lowerBars: OhlcBar[]
  /** 直下 TF の 1 バーの秒数 */
  lowerTfSec: number
  /** 直下 TF 名(色決定用) */
  lowerTf: string
}

/**
 * §5.1.6 下位 TF レンジ背景。
 *
 * 自 pane に「`visibleTfs` 上で 1 つ下に並ぶ TF」の現在の表示時間レンジを半透明
 * 縦帯で重ね、マルチ TF で「下位足のどこを見ているか」を上位足側から一目で
 * 把握できるようにする補助表示。
 *
 * 設計の核 — 変換経路を logical 一本化(invariants.md I-12 / frontend-chart.md §2):
 *   lower の visible logical → 時刻 → upper の logical → px
 *
 *   時刻 ↔ logical 変換は overlay 内部の純粋関数(`logicalToTime` /
 *   `timeToLogical`)で bar 配列 + `tfSec` を使い線形補間する。LWC 依存は
 *   `getVisibleLogicalRange` と `logicalToCoordinate` のみで、`timeToCoordinate`
 *   は使わない(時刻が upper TF のバー境界に乗らないとき null を返す経路があり、
 *   フォールバック分岐が TF 間で挙動分散の温床になる)。
 *
 * snap は「両 pane が共に末端を表示」の AND 条件のときだけ:
 *   - 右端: `lowerRange.to >= lowerLastIdx && upperRange.to >= upperLastIdx`
 *           → 帯右端 logical = `upperRange.to`
 *   - 左端: `lowerRange.from <= 0 && upperRange.from <= 0`
 *           → 帯左端 logical = `upperRange.from`
 *
 *   snap が必要な唯一の理由は rightOffset の TF 間時間幅不一致(M15→H4 なら
 *   4×15min vs 4×240min)。両 pane が末端でない通常領域では時刻 mapping だけで
 *   正しく追従するため snap は不要。
 *
 * broker のヒストリ制限で upper のバー数が lower の時刻範囲に届かない場合は、
 * 変換後の logical が負値 / `lastIdx` 超過になるが `logicalToCoordinate` の
 * 線形外挿で px が返るため、帯が pane 外に伸びる形で SVG クリップに任せる
 * (クランプしない、I-12.3)。
 *
 * 自 handle と下位 handle の両方の `subscribeRedraw` を購読し、いずれかの
 * pan / zoom / resize で再計算する。read-only でクロス TF state を一切
 * 書き換えない。
 */
export function LowerTfRangeOverlay({
  upperHandle, upperBars, upperTfSec,
  lowerHandle, lowerBars, lowerTfSec,
  lowerTf,
}: Props) {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!upperHandle || !lowerHandle) return
    const bump = () => setTick(t => t + 1)
    const u1 = upperHandle.subscribeRedraw(bump)
    const u2 = lowerHandle.subscribeRedraw(bump)
    return () => {
      u1()
      u2()
    }
  }, [upperHandle, lowerHandle])

  if (!upperHandle || !lowerHandle) return null
  if (upperBars.length === 0 || lowerBars.length === 0) return null

  const lowerRange = lowerHandle.getVisibleLogicalRange()
  if (!lowerRange) return null
  const upperRange = upperHandle.getVisibleLogicalRange()
  if (!upperRange) return null

  const lowerLastIdx = lowerBars.length - 1
  const upperLastIdx = upperBars.length - 1

  // lower visible logical → 時刻
  const tFrom = logicalToTime(lowerRange.from, lowerBars, lowerTfSec)
  const tTo = logicalToTime(lowerRange.to, lowerBars, lowerTfSec)

  // 時刻 → upper logical
  let projFrom = timeToLogical(tFrom, upperBars, upperTfSec)
  let projTo = timeToLogical(tTo, upperBars, upperTfSec)

  // AND snap: 両 pane が共に末端を表示しているときだけ、帯端を upper の visible 端へ
  // 合わせる(rightOffset の TF 間時間幅不一致を吸収する唯一の補正)。
  if (lowerRange.to >= lowerLastIdx && upperRange.to >= upperLastIdx) projTo = upperRange.to
  if (lowerRange.from <= 0 && upperRange.from <= 0) projFrom = upperRange.from

  // LWC の `logicalToCoordinate` は **fractional logical を受け付けず 0 を返す** 不具合がある
  // (整数は正しく動く)。projFrom / projTo は時刻補間で fractional になり得るため、整数
  // 2 点を取って線形補間する自前ラッパで bypass する。詳細は frontend-chart.md §3.1。
  const x1 = logicalToXFractional(upperHandle, projFrom)
  const x2 = logicalToXFractional(upperHandle, projTo)
  if (x1 === null || x2 === null) return null

  const left = Math.min(x1, x2)
  const width = Math.abs(x2 - x1)
  if (width <= 0) return null

  const color = getTimeframeColor(lowerTf)

  return (
    <svg
      className="lower-tf-range-overlay"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
      width="100%"
      height="100%"
    >
      <rect
        x={left}
        y={0}
        width={width}
        height="100%"
        fill={color}
        fillOpacity={0.08}
      />
    </svg>
  )
}

/**
 * `logicalToX` の fractional 対応ラッパ。
 *
 * LWC の `timeScale.logicalToCoordinate(fractional)` は **fractional な引数を受け付けず 0 を
 * 返す** 不具合がある(整数は正しく動く)。本 overlay は時刻 → logical 変換で fractional に
 * なり得るので、整数 2 点(`floor(logical)` と `floor(logical) + 1`)で px を取り、
 * 線形補間して fractional 位置の px を求める。これにより LWC の制約を 1 箇所で吸収する。
 *
 * 範囲外 logical(< 0 や > lastIdx)はそのまま渡しても LWC が線形外挿で px を返すため
 * (整数の場合)、本ラッパも整数化するだけで動く。
 */
function logicalToXFractional(handle: ChartHandle, logical: number): number | null {
  const lo = Math.floor(logical)
  const frac = logical - lo
  const xLo = handle.api.logicalToX(lo)
  if (xLo === null) return null
  if (frac === 0) return xLo
  const xHi = handle.api.logicalToX(lo + 1)
  if (xHi === null) return null
  return xLo + frac * (xHi - xLo)
}

/**
 * 浮動小数の logical を時刻(Unix 秒)に変換する。
 * - `0 <= logical <= lastIdx`: bars[floor(logical)] を起点に `tfSec` で線形補間
 * - `logical < 0`: bars[0] を起点に外挿(過去側、結果は bars[0].t より小)
 * - `logical > lastIdx`: bars[lastIdx] を起点に外挿(rightOffset whitespace 含む未来側)
 */
function logicalToTime(logical: number, bars: OhlcBar[], tfSec: number): number {
  const lastIdx = bars.length - 1
  if (logical >= lastIdx) return bars[lastIdx].t + (logical - lastIdx) * tfSec
  if (logical <= 0) return bars[0].t + logical * tfSec
  const lo = Math.floor(logical)
  return bars[lo].t + (logical - lo) * tfSec
}

/**
 * 時刻(Unix 秒)を浮動小数の logical に変換する。
 * - `time >= bars[lastIdx].t`: lastIdx を起点に外挿(将来側)
 * - `time <= bars[0].t`: bars[0] を起点に外挿(過去側、結果は負値)
 * - in-range: 二分探索で `bars[lo].t <= time < bars[lo+1].t` を求めて線形補間
 */
function timeToLogical(time: number, bars: OhlcBar[], tfSec: number): number {
  const lastIdx = bars.length - 1
  if (time >= bars[lastIdx].t) return lastIdx + (time - bars[lastIdx].t) / tfSec
  if (time <= bars[0].t) return (time - bars[0].t) / tfSec
  let lo = 0
  let hi = lastIdx
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid].t <= time) lo = mid
    else hi = mid - 1
  }
  return lo + (time - bars[lo].t) / tfSec
}
