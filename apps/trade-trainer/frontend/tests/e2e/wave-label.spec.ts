/**
 * 波動ラベル auto-advance + ホットキー (ver 1.77)
 * 波動ラベルボタンを押してチャートに配置すると次の波動に自動遷移することを検証する。
 */
import { test, expect } from '@playwright/test'
import {
  login,
  findSessionForPhase,
  navigateToSession,
  waitForChartTest,
  paneCenterX,
} from './helpers/chart'

// 推進波 → 補正波の順に並ぶ波動ラベル一覧
const IMPULSE_WAVES = ['1', '2', '3', '4', '5'] as const
const CORRECTIVE_WAVES = ['A', 'B', 'C'] as const

test.describe('波動ラベル auto-advance + ホットキー (ver 1.77)', () => {
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

  test('波動ラベルボタンが描画ツールバーに表示される', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)
    await page.waitForSelector('.drawing-tools', { timeout: 10_000 })

    // 推進波ボタン(1〜5)が存在する
    for (const w of IMPULSE_WAVES) {
      await expect(
        page.locator('.wave-btn', { hasText: w }),
        `推進波ボタン「${w}」が見つからない`,
      ).toBeVisible()
    }
    // 補正波ボタン(A, B, C)が存在する
    for (const w of CORRECTIVE_WAVES) {
      await expect(
        page.locator('.wave-btn', { hasText: w }),
        `補正波ボタン「${w}」が見つからない`,
      ).toBeVisible()
    }
  })

  test('波動ラベルボタンをクリックするとアクティブになる', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)
    await page.waitForSelector('.wave-btn', { timeout: 10_000 })

    // 波動 '1' ボタンをクリック
    await page.locator('.wave-btn', { hasText: '1' }).click()
    await expect(
      page.locator('.wave-btn', { hasText: '1' }),
      'クリック後に active クラスが付かない',
    ).toHaveClass(/active/)
  })

  test('波動ラベルをチャートに配置すると次の波動に auto-advance する', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    await waitForChartTest(page, 'M5')
    await page.waitForSelector('.wave-btn', { timeout: 10_000 })

    // wave '1' ツールをアクティブにする
    await page.locator('.wave-btn', { hasText: '1' }).click()
    await expect(page.locator('.wave-btn', { hasText: '1' })).toHaveClass(/active/)

    // M5 ペイン中央付近をクリックしてラベルを配置
    const cx = await paneCenterX(page, 'M5')
    if (cx == null) test.skip(true, 'M5 ペインが見つかりません')
    await page.mouse.click(cx!, 300)
    await page.waitForTimeout(200)

    // auto-advance: '1' を配置したので '2' がアクティブになるはず
    await expect(
      page.locator('.wave-btn', { hasText: '2' }),
      '波動 1 配置後に 2 が active にならない',
    ).toHaveClass(/active/)
  })

  test('波動 5 を配置すると A に auto-advance する(推進→補正)', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    await waitForChartTest(page, 'M5')
    await page.waitForSelector('.wave-btn', { timeout: 10_000 })

    // wave '5' ツールをアクティブにする
    await page.locator('.wave-btn', { hasText: '5' }).click()
    await expect(page.locator('.wave-btn', { hasText: '5' })).toHaveClass(/active/)

    const cx = await paneCenterX(page, 'M5')
    if (cx == null) test.skip(true, 'M5 ペインが見つかりません')
    await page.mouse.click(cx!, 300)
    await page.waitForTimeout(200)

    // '5' → 'A' に auto-advance するはず
    await expect(
      page.locator('.wave-btn', { hasText: 'A' }),
      '波動 5 配置後に A が active にならない',
    ).toHaveClass(/active/)
  })

  test('Escape キーで波動ラベルツールが解除される', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)
    await page.waitForSelector('.wave-btn', { timeout: 10_000 })

    // wave ツールをアクティブに
    await page.locator('.wave-btn', { hasText: '1' }).click()
    await expect(page.locator('.wave-btn', { hasText: '1' })).toHaveClass(/active/)

    // Escape で解除
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    await expect(
      page.locator('.wave-btn', { hasText: '1' }),
      'Escape 後もツールが active のまま',
    ).not.toHaveClass(/active/)
  })
})
