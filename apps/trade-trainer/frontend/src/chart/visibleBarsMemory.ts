// 仕様書 §5.1.3: 銘柄切替時に「直前と同じ表示本数」を維持するためのメモリ。
//
// `<Chart key={tf-symbol}>` が銘柄切替で unmount/remount されるため、Chart 内 React state
// では持続できない。モジュールスコープの Map に「TF ごとの可視幅(visible logical range の
// to - from)」を保持して跨ぐ。ページ離脱で破棄。

const visibleWidthByTf = new Map<string, number>()

export function getVisibleWidth(tf: string, fallback: number): number {
  const stored = visibleWidthByTf.get(tf)
  return stored != null && stored > 0 ? stored : fallback
}

export function setVisibleWidth(tf: string, width: number): void {
  if (width > 0 && Number.isFinite(width)) {
    visibleWidthByTf.set(tf, width)
  }
}
