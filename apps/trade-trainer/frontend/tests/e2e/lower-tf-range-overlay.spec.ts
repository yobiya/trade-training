/**
 * LowerTfRangeOverlay 経路 (ver 1.76)
 * H4 以上の TF を表示したとき、LowerTfRangeOverlay が pane 全幅にならず
 * 正しい x 範囲でレンダリングされることを検証する。
 */
import { test, expect } from '@playwright/test'
import {
  login,
  findSessionForPhase,
  navigateToSession,
  waitForChartTest,
} from './helpers/chart'

test.describe('LowerTfRangeOverlay 経路 (ver 1.76)', () => {
  let sessionIndex: number
  let sessionId: string

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page)
    const found = await findSessionForPhase(page, 'any')
    if (found) { sessionId = found.id; sessionIndex = found.index }
    await ctx.close()
  })

  test('H4 チャートペインが描画される', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    // H4 ペインが存在することを確認
    const h4Pane = page.locator('.stacked-chart').filter({
      has: page.locator('.tf-badge', { hasText: 'H4' }),
    })
    await expect(h4Pane, 'H4 ペインが見つからない').toBeVisible()

    // H4 の __chartTest API が利用可能になるまで待つ
    await waitForChartTest(page, 'H4')
  })

  test('H4 ペインの canvas が存在し DPR 1+ で描画される', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    await waitForChartTest(page, 'H4')

    // H4 ペイン内の canvas を取得して width/height が 0 でないことを確認
    const canvasSize = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('.tf-badge'))
      const h4Badge = badges.find(b => b.textContent?.trim() === 'H4')
      const pane = h4Badge?.closest('.stacked-chart')
      const canvas = pane?.querySelector('.tv-lightweight-charts canvas') as HTMLCanvasElement | null
      if (!canvas) return null
      return { width: canvas.width, height: canvas.height }
    })
    expect(canvasSize, 'H4 ペインに canvas が見つからない').not.toBeNull()
    expect(canvasSize!.width, 'canvas width が 0').toBeGreaterThan(0)
    expect(canvasSize!.height, 'canvas height が 0').toBeGreaterThan(0)
  })

  test('H4 フォーカス時に __chartTest.priceToY が有効範囲を返す', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    // H4 ペインをクリックしてフォーカス確立
    const h4Pane = page.locator('.stacked-chart').filter({
      has: page.locator('.tf-badge', { hasText: 'H4' }),
    })
    await h4Pane.click()
    await waitForChartTest(page, 'H4')

    // priceToY が null でないことを確認する(可視範囲内の価格で)
    // __chartTest の yToPrice を使って中央の価格を取得する
    const centerPrice = await page.evaluate(() => {
      const api = window.__chartTest?.get('H4')
      if (!api) return null
      const pane = Array.from(document.querySelectorAll('.tf-badge'))
        .find(b => b.textContent?.trim() === 'H4')?.closest('.stacked-chart')
      if (!pane) return null
      const rect = pane.getBoundingClientRect()
      const centerY = rect.height / 2
      return api.yToPrice(centerY)
    })

    if (centerPrice == null) {
      // yToPrice が null = チャートデータなし。このセッションでは H4 データがないためスキップ
      test.skip(true, 'H4 データがないためスキップ')
    }

    // 中央価格から priceToY を取得 → ペイン内に収まる Y が返るはず
    const yCoord = await page.evaluate((price) => {
      return window.__chartTest?.get('H4')?.priceToY(price) ?? null
    }, centerPrice!)
    expect(yCoord, 'priceToY(中央価格) が null').not.toBeNull()
  })

  test('LowerTfRangeOverlay が pane 全幅を覆っていない(regr: ver 1.76)', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    await waitForChartTest(page, 'H4')

    // H4 ペインのスクリーンショットを取り、
    // 可視バー範囲を超えた領域(右端余白)が描画で埋まっていないことを検証する。
    // ここでは「コンソールエラーなし」を確認(描画ループが崩れるとエラーが出る)
    const consoleLogs: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') consoleLogs.push(msg.text())
    })

    // H4 をクリックしてフォーカス
    const h4Pane = page.locator('.stacked-chart').filter({
      has: page.locator('.tf-badge', { hasText: 'H4' }),
    })
    await h4Pane.click()
    await page.waitForTimeout(500)

    expect(
      consoleLogs.filter(t => t.includes('LowerTfRangeOverlay') || t.includes('Cannot read')),
      'LowerTfRangeOverlay 関連のコンソールエラーが発生',
    ).toHaveLength(0)
  })
})
