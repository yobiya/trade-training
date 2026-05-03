/**
 * SL/TP drag 移動 (ver 1.80)
 * 保有中フェーズで SL を drag → PATCH が発火 → backend に反映されることを一気通貫で検証する。
 *
 * 前提: 進行中(is_settled=false)かつ active trade がある(holding フェーズ)セッションが存在すること。
 */
import { test, expect } from '@playwright/test'
import {
  login,
  findSessionForPhase,
  navigateToSession,
  waitForChartTest,
  viewportY,
  paneCenterX,
  dragVertical,
  getCanvasCursor,
  getActiveTrade,
  API,
} from './helpers/chart'

test.describe('SL/TP drag 移動 (ver 1.80)', () => {
  let sessionId: string
  let sessionIndex: number

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page)
    const found = await findSessionForPhase(page, 'holding')
    if (found) {
      sessionId = found.id
      sessionIndex = found.index
    }
    await ctx.close()
  })

  test('SL 線にホバーするとカーソルが ns-resize になる', async ({ page }) => {
    if (!sessionId) test.skip(true, 'holding フェーズのセッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    const trade = await getActiveTrade(page, sessionId)
    if (!trade?.sl) test.skip(true, 'SL が設定されていません')

    await waitForChartTest(page, 'M5')

    const slViewY = await viewportY(page, 'M5', trade.sl!)
    if (slViewY == null) test.skip(true, 'SL が可視範囲外です')

    const cx = await paneCenterX(page, 'M5')
    if (cx == null) test.skip(true, 'M5 ペインが見つかりません')

    // SL 線の Y 座標にホバー
    await page.mouse.move(cx, slViewY!)
    await page.waitForTimeout(200)
    const cursor = await getCanvasCursor(page)
    expect(cursor, 'SL 線上で ns-resize にならない').toBe('ns-resize')
  })

  test('SL を drag すると backend の sl が更新される', async ({ page }) => {
    if (!sessionId) test.skip(true, 'holding フェーズのセッションが見つかりません')
    await login(page)
    await navigateToSession(page, sessionIndex)

    const tradeBefore = await getActiveTrade(page, sessionId)
    if (!tradeBefore?.sl) test.skip(true, 'SL が設定されていません')

    await waitForChartTest(page, 'M5')

    const slViewY = await viewportY(page, 'M5', tradeBefore.sl!)
    if (slViewY == null) test.skip(true, 'SL が可視範囲外です')

    const cx = await paneCenterX(page, 'M5')
    if (cx == null) test.skip(true, 'M5 ペインが見つかりません')

    // 現在 SL から 20px 下(値幅は TF / 価格によって異なる)に drag
    const targetY = slViewY! + 20

    // PATCH /trade のリクエストを監視
    const patchPromise = page.waitForRequest(
      req => req.url().includes('/trade') && req.method() === 'PATCH',
      { timeout: 5_000 },
    ).catch(() => null)

    await dragVertical(page, cx, slViewY!, targetY)
    await page.mouse.up()

    const patchReq = await patchPromise
    expect(patchReq, 'drag 後に PATCH /trade が発火されていない').not.toBeNull()

    // backend に反映されるまで少し待つ
    await page.waitForTimeout(500)
    const tradeAfter = await getActiveTrade(page, sessionId)
    expect(tradeAfter?.sl, '新しい SL が backend に保存されていない').not.toBeNull()
    expect(tradeAfter!.sl, 'SL が変化していない').not.toBeCloseTo(tradeBefore.sl!, 2)
  })

  test('振り返りフェーズでは SL drag が無効(drag しても SL 変化なし)', async ({ page }) => {
    // reviewing フェーズのセッションを探す
    await login(page)
    const found = await findSessionForPhase(page, 'analyzing')
    if (!found) test.skip(true, 'reviewing または analyzing フェーズのセッションが見つかりません')

    await navigateToSession(page, found.index)
    await waitForChartTest(page, 'M5')

    // analyzing フェーズに active trade はないので SL がない → drag が無効であることの確認として
    // PATCH が発火されないことを検証
    const cx = await paneCenterX(page, 'M5')
    if (cx == null) test.skip(true, 'M5 ペインが見つかりません')

    let patchFired = false
    page.on('request', req => {
      if (req.url().includes('/trade') && req.method() === 'PATCH') patchFired = true
    })

    // 画面中央付近を drag しても PATCH が出ないことを確認
    const paneY = 200
    await dragVertical(page, cx, paneY, paneY + 30)
    await page.waitForTimeout(500)

    expect(patchFired, 'analyzing フェーズで PATCH /trade が発火された').toBe(false)
  })
})
