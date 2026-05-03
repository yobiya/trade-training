/**
 * advance フォーカス TF 境界アライメント (ver 1.79)
 * フォーカス TF に合わせて advance が次の TF バー境界まで進むことを検証する。
 *
 * 例: H1 フォーカス時に 10:15 → advance +1 → 11:00(次の H1 バー先頭)
 */
import { test, expect } from '@playwright/test'
import {
  login,
  findSessionForPhase,
  navigateToSession,
  getSession,
  nextH1BoundaryUTC,
} from './helpers/chart'

/** UTC ISO 文字列から「時:分」を取り出す。 */
function hhmm(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16)
}

/** ISO 時刻が H1 バー境界(分=0)かどうかを確認する。 */
function isH1Boundary(iso: string): boolean {
  return new Date(iso).getUTCMinutes() === 0
}

test.describe('advance: フォーカス TF 境界アライメント (ver 1.79)', () => {
  let sessionId: string
  let sessionIndex: number

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page)
    // analyzing / holding どちらでも可(advance が使えるフェーズ)
    const found = await findSessionForPhase(page, 'any')
    if (found) { sessionId = found.id; sessionIndex = found.index }
    await ctx.close()
  })

  test('+1本 advance 後に current_position が前進する', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    const before = await getSession(page, sessionId)
    const timeBefore = before.current_position

    // +1本 ボタンをクリック
    await page.locator('.advance-btn').first().click()
    // advance API レスポンスを待つ
    await page.waitForResponse(
      r => r.url().includes('/advance') && r.status() === 200,
      { timeout: 10_000 },
    )

    const after = await getSession(page, sessionId)
    expect(
      new Date(after.current_position).getTime(),
      `advance 後に current_position が変化していない(${timeBefore} → ${after.current_position})`,
    ).toBeGreaterThan(new Date(timeBefore).getTime())
  })

  test('H1 フォーカス時の +1本 advance は次の H1 境界に到達する', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    const before = await getSession(page, sessionId)
    // H1 境界上にある場合はそのまま進めても 1 本なので境界になるとは限らない
    // 境界上でない時刻のときのみテスト
    if (isH1Boundary(before.current_position)) {
      test.skip(true, `current_position が既に H1 境界(${hhmm(before.current_position)})なのでスキップ`)
    }

    // H1 チャートペインをクリックしてフォーカスを確立
    const h1Pane = page.locator('.stacked-chart').filter({
      has: page.locator('.tf-badge', { hasText: 'H1' }),
    })
    await h1Pane.click()
    await page.waitForTimeout(200)

    // +1本 advance
    await page.locator('.advance-btn').first().click()
    await page.waitForResponse(
      r => r.url().includes('/advance') && r.status() === 200,
      { timeout: 10_000 },
    )

    const after = await getSession(page, sessionId)
    const expectedBoundary = nextH1BoundaryUTC(before.current_position)

    expect(
      new Date(after.current_position).getTime(),
      `H1 フォーカス advance 後の時刻が期待する H1 境界(${expectedBoundary.toISOString()})と一致しない。実際: ${after.current_position}`,
    ).toBe(expectedBoundary.getTime())
  })

  test('+5本 advance 後も current_position が前進する', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    const before = await getSession(page, sessionId)

    // +5本 ボタン(2番目の .advance-btn)
    await page.locator('.advance-btn').nth(1).click()
    await page.waitForResponse(
      r => r.url().includes('/advance') && r.status() === 200,
      { timeout: 10_000 },
    )

    const after = await getSession(page, sessionId)
    expect(
      new Date(after.current_position).getTime(),
      '+5本 advance 後に current_position が変化しない',
    ).toBeGreaterThan(new Date(before.current_position).getTime())
  })
})
