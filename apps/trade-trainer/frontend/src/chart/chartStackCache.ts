// 仕様書 §5.1.6: `/chart-stack` レスポンスを (symbol, current_position, tfsKey) キーで
// クライアント in-memory にキャッシュ。同タブ内で銘柄を行き来した際の 2 回目以降は
// MT5 ラウンドトリップなしで描画される。
//
// useCharts が銘柄切替で再マウントされても生存させたいのでモジュールスコープ Map を採用。
// タブクローズ / ブラウザ刷新で破棄される(永続化は spec §5.1.6 で対象外)。
//
// **前提条件**: §5.1.3 の Chart instance 永続化が成立していること。Chart が銘柄切替で
// remount される設計だと、cache hit 時にライブラリの visible range 自動再計算が走って
// 表示位置が壊れる(ver 1.72 で remount を撤廃したことでこの前提が成立した)。

import type { ChartStackEntry } from '../api/types'

export type CachedStack = { stacks: ChartStackEntry[] }

/** Map は挿入順を保つので、これ自体を簡易 LRU として使う(ヒット時に delete + set で末尾へ移動) */
const cache = new Map<string, CachedStack>()
const MAX_ENTRIES = 50

function makeKey(symbol: string, currentPos: string, tfsKey: string): string {
  return `${symbol}|${currentPos}|${tfsKey}`
}

/**
 * キャッシュを参照する。`currentPos` が null(セッション未ロード)の場合は常にミス扱い。
 * ヒット時は再挿入で「最近使用」扱いに昇格させる。
 */
export function getCachedStack(
  symbol: string,
  currentPos: string | null,
  tfsKey: string,
): CachedStack | null {
  if (!currentPos) return null
  const k = makeKey(symbol, currentPos, tfsKey)
  const v = cache.get(k)
  if (!v) return null
  cache.delete(k)
  cache.set(k, v)
  return v
}

/**
 * キャッシュへ書き込む。サイズ上限を超えたら最古エントリ(挿入順 Map の先頭)を破棄。
 * `currentPos` が null の場合はキャッシュしない。
 */
export function setCachedStack(
  symbol: string,
  currentPos: string | null,
  tfsKey: string,
  value: CachedStack,
): void {
  if (!currentPos) return
  const k = makeKey(symbol, currentPos, tfsKey)
  if (cache.size >= MAX_ENTRIES && !cache.has(k)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(k, value)
}
