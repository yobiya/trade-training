// 仕様書 §2.11 / §5.1.4: 表示層は全て JST(Asia/Tokyo)。

const TZ = 'Asia/Tokyo'

export function formatJST(iso: string | Date | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleString('ja-JP', { timeZone: TZ })
}

export function formatJSTDate(iso: string | Date | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString('ja-JP', { timeZone: TZ })
}

/**
 * §5.1.4 lightweight-charts の時間軸ラベルを JST で整形する。
 * LWC は `tickMarkType` で表示すべき粒度を渡してくるので、その粒度に応じた最小限の文字列を返す。
 * time は UTCTimestamp(秒)を想定(本コードベースの OHLC は全て UTC 秒)。BusinessDay 等は素直に空文字列。
 */
export function jstTickMarkFormatter(time: unknown, tickMarkType: number): string {
  if (typeof time !== 'number') return ''
  const d = new Date(time * 1000)
  switch (tickMarkType) {
    case 0:  // Year
      return d.toLocaleDateString('ja-JP', { timeZone: TZ, year: 'numeric' })
    case 1: {  // Month
      // 「5月」のように短く表示(年は別ラベルで出る)
      const m = d.toLocaleString('en-US', { timeZone: TZ, month: 'short' })
      return m
    }
    case 2:  // DayOfMonth
      return String(Number(d.toLocaleString('en-US', { timeZone: TZ, day: 'numeric' })))
    case 3:  // Time
      return d.toLocaleTimeString('ja-JP', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
      })
    case 4:  // TimeWithSeconds
      return d.toLocaleTimeString('ja-JP', {
        timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    default:
      return ''
  }
}

/**
 * §5.1.4 lightweight-charts のクロスヘア / ツールチップの時刻を JST で整形する。
 * UTCTimestamp(秒)を `MM/DD HH:MM`(JST)で返す。
 */
export function jstCrosshairTimeFormatter(time: unknown): string {
  if (typeof time !== 'number') return ''
  const d = new Date(time * 1000)
  return d.toLocaleString('ja-JP', {
    timeZone: TZ,
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
