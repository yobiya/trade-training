import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { TradingStyle } from '../api/client'

/**
 * 有効なトレードスタイル一覧を取得する(仕様書 §8)。
 * 編集 UI は別途 settings 画面で提供(将来)。
 */
export function useTradingStyles(): TradingStyle[] {
  const [styles, setStyles] = useState<TradingStyle[]>([])
  useEffect(() => {
    void api.tradingStyles.list().then(setStyles)
  }, [])
  return styles
}
