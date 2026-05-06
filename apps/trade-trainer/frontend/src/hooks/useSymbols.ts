import { useEffect, useState } from 'react'
import { api } from '../api/client'

/**
 * §2.8 銘柄一覧を backend から取得する hook。
 *
 * 真実の所有者は `config/symbols.toml`(backend が読み出して `/api/settings/symbols` で配信)。
 * frontend には銘柄リストのハードコードを置かない。
 *
 * - アプリ起動時に 1 回 fetch、module-scope に cache。複数の hook 利用箇所で同じ配列を共有
 * - 取得前は `null`(SessionPage は空配列フォールバックで描画)
 */
let _cachedSymbols: string[] | null = null
let _inflight: Promise<string[]> | null = null

async function fetchSymbols(): Promise<string[]> {
  if (_cachedSymbols) return _cachedSymbols
  if (_inflight) return _inflight
  _inflight = api.settings.getSymbols()
    .then((r) => {
      _cachedSymbols = r.symbols
      return r.symbols
    })
    .finally(() => {
      _inflight = null
    })
  return _inflight
}

export function useSymbols(): string[] | null {
  const [symbols, setSymbols] = useState<string[] | null>(_cachedSymbols)

  useEffect(() => {
    if (_cachedSymbols) {
      if (symbols !== _cachedSymbols) setSymbols(_cachedSymbols)
      return
    }
    let cancelled = false
    fetchSymbols()
      .then((s) => {
        if (!cancelled) setSymbols(s)
      })
      .catch(() => {
        // 通知は SessionPage 側に任せる(本 hook はリストだけ返す)
        if (!cancelled) setSymbols([])
      })
    return () => {
      cancelled = true
    }
  }, [symbols])

  return symbols
}
