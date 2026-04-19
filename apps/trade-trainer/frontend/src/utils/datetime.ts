// 仕様書 §2.11: 表示層は全て JST(Asia/Tokyo)。

export function formatJST(iso: string | Date | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })
}

export function formatJSTDate(iso: string | Date | null | undefined, fallback = '—'): string {
  if (!iso) return fallback
  const date = typeof iso === 'string' ? new Date(iso) : iso
  return date.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })
}
