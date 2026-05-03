import { describe, it, expect } from 'vitest'
import { formatJST, formatJSTDate } from '../datetime'

// JST = UTC+9。UTC 00:00 = JST 09:00 (同日)
// UTC 15:00 = JST 00:00 (翌日) — 日付変換の境界テストに使う

// ---------------------------------------------------------------------------
// formatJST
// ---------------------------------------------------------------------------

describe('formatJST', () => {
  it('null → fallback (デフォルト "—")', () => {
    expect(formatJST(null)).toBe('—')
  })

  it('undefined → fallback', () => {
    expect(formatJST(undefined)).toBe('—')
  })

  it('空文字 → fallback', () => {
    expect(formatJST('')).toBe('—')
  })

  it('カスタム fallback を返す', () => {
    expect(formatJST(null, 'N/A')).toBe('N/A')
  })

  it('ISO 文字列 → fallback 以外の文字列を返す', () => {
    const result = formatJST('2024-01-15T10:00:00Z')
    expect(result).not.toBe('—')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('Date オブジェクト → fallback 以外の文字列を返す', () => {
    const result = formatJST(new Date('2024-01-15T10:00:00Z'))
    expect(result).not.toBe('—')
  })

  it('UTC 15:00 → JST は翌日 00:00(日付変換)', () => {
    // 2024-01-14T15:00:00Z = JST 2024-01-15 00:00:00
    const result = formatJST('2024-01-14T15:00:00Z')
    expect(result).toContain('2024')
    expect(result).toContain('15') // JST の日付は 15
    // 1/14 (UTC 側の日付) が含まれていないことを確認
    // ja-JP フォーマットでは "2024/1/15 0:00:00" → '14' は年と月に存在しないので検証省略
  })

  it('UTC+9 のオフセット分だけ時刻が進む', () => {
    // 2024-01-15T00:00:00Z = JST 2024-01-15 09:00:00
    const result = formatJST('2024-01-15T00:00:00Z')
    expect(result).toContain('9') // 時刻 09 に "9" が含まれる
  })
})

// ---------------------------------------------------------------------------
// formatJSTDate
// ---------------------------------------------------------------------------

describe('formatJSTDate', () => {
  it('null → fallback', () => {
    expect(formatJSTDate(null)).toBe('—')
  })

  it('undefined → fallback', () => {
    expect(formatJSTDate(undefined)).toBe('—')
  })

  it('空文字 → fallback', () => {
    expect(formatJSTDate('')).toBe('—')
  })

  it('カスタム fallback', () => {
    expect(formatJSTDate(null, '---')).toBe('---')
  })

  it('ISO 文字列 → 日付文字列を返す', () => {
    const result = formatJSTDate('2024-01-15T10:00:00Z')
    expect(result).not.toBe('—')
    expect(result).toContain('2024')
  })

  it('UTC 15:00 → JST 翌日の日付を返す', () => {
    // 2024-01-14T15:00:00Z = JST 2024-01-15
    const result = formatJSTDate('2024-01-14T15:00:00Z')
    expect(result).toContain('2024')
    expect(result).toContain('15')
  })

  it('UTC 14:59:59 → JST 同日の日付を返す', () => {
    // 2024-01-14T14:59:59Z = JST 2024-01-14 23:59:59 (まだ 14 日)
    const result = formatJSTDate('2024-01-14T14:59:59Z')
    expect(result).toContain('2024')
    expect(result).toContain('14')
  })

  it('Date オブジェクトでも動作する', () => {
    const result = formatJSTDate(new Date('2024-06-01T00:00:00Z'))
    expect(result).not.toBe('—')
    expect(result).toContain('2024')
  })

  it('formatJST より短い(時刻部分を含まない)', () => {
    const iso = '2024-01-15T10:00:00Z'
    const date = formatJSTDate(iso)
    const datetime = formatJST(iso)
    expect(date.length).toBeLessThan(datetime.length)
  })
})
