/**
 * chart-stack: 最新 N バー保証 (ver 1.78)
 * 週末 current_pos などのエッジケースでも全 TF に bars が返ることを検証する。
 */
import { test, expect } from '@playwright/test'
import { API, login, findSessionForPhase } from './helpers/chart'

const REQUIRED_TFS = ['M5', 'M15', 'H1', 'H4', 'D1', 'W1', 'MN1']

test.describe('chart-stack: 全 TF バー保証 (ver 1.78)', () => {
  let sessionId: string | null = null

  test.beforeAll(async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page)
    const found = await findSessionForPhase(page, 'any')
    sessionId = found?.id ?? null
    await ctx.close()
  })

  test('全 TF エントリが存在する', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    const resp = await page.request.get(`${API}/sessions/${sessionId}/chart-stack`)
    expect(resp.ok(), `GET /chart-stack HTTP ${resp.status()}`).toBe(true)
    const data = await resp.json()
    for (const tf of REQUIRED_TFS) {
      const entry = (data.stacks as { timeframe: string }[]).find(s => s.timeframe === tf)
      expect(entry, `${tf} のスタックが stacks に存在しない`).toBeTruthy()
    }
  })

  test('全 TF に 1 本以上の bars がある', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    const resp = await page.request.get(`${API}/sessions/${sessionId}/chart-stack`)
    const data = await resp.json()
    for (const tf of REQUIRED_TFS) {
      const entry = (data.stacks as { timeframe: string; bars: unknown[] }[]).find(s => s.timeframe === tf)
      expect(entry?.bars.length ?? 0, `${tf} に bars がない`).toBeGreaterThan(0)
    }
  })

  test('current_position が ISO 8601 形式', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    const resp = await page.request.get(`${API}/sessions/${sessionId}/chart-stack`)
    const data = await resp.json()
    // ISO 8601: "2024-01-15T10:30:00" のようなパターン
    expect(data.current_position).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)
  })

  test('bars は昇順(I-7: バー昇順)', async ({ page }) => {
    if (!sessionId) test.skip(true, '進行中セッションが見つかりません')
    await login(page)
    const resp = await page.request.get(`${API}/sessions/${sessionId}/chart-stack`)
    const data = await resp.json()
    const m5 = (data.stacks as { timeframe: string; bars: { t: number }[] }[])
      .find(s => s.timeframe === 'M5')
    if (!m5 || m5.bars.length < 2) return
    for (let i = 1; i < m5.bars.length; i++) {
      expect(m5.bars[i].t, `M5 bars[${i}].t が前バーより小さい(降順)`).toBeGreaterThan(m5.bars[i - 1].t)
    }
  })
})
