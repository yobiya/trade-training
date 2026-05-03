/**
 * Playwright e2e テスト共通ヘルパー。
 * 全ヘルパーは page.request 経由(= ページと同じ cookie を共有)でリクエストする。
 */
import type { Page } from '@playwright/test'

export const API = 'http://localhost:5173/api'

// E2E_PASSWORD 未設定時は 'changeme' にフォールバック
export const E2E_PASSWORD = process.env['E2E_PASSWORD'] ?? 'changeme'

// ---------------------------------------------------------------------------
// 型 (API レスポンスの必要最小限)
// ---------------------------------------------------------------------------

export type SessionItem = {
  id: string
  symbol: string | null
  is_settled: boolean
  presented_at: string
}

export type TradeInfo = {
  id: string
  direction: 'buy' | 'sell'
  entry_price: number
  sl: number | null
  tp: number | null
  exit_time: string | null
  is_open: boolean
}

export type ChartStackEntry = {
  timeframe: string
  bars: { t: number; o: number; h: number; l: number; c: number; v: number }[]
}

export type ChartStackResponse = {
  symbol: string
  current_position: string
  stacks: ChartStackEntry[]
}

// ---------------------------------------------------------------------------
// 認証
// ---------------------------------------------------------------------------

export async function login(page: Page, password = E2E_PASSWORD): Promise<void> {
  const resp = await page.request.post(`${API}/auth/login`, {
    data: { password },
  })
  if (!resp.ok()) throw new Error(`ログイン失敗 (HTTP ${resp.status()})`)
}

// ---------------------------------------------------------------------------
// セッション操作
// ---------------------------------------------------------------------------

export async function getSessionList(page: Page): Promise<SessionItem[]> {
  const resp = await page.request.get(`${API}/sessions?limit=100`)
  if (!resp.ok()) throw new Error(`GET /sessions 失敗 (HTTP ${resp.status()})`)
  return resp.json()
}

export async function getActiveTrade(page: Page, sessionId: string): Promise<TradeInfo | null> {
  const resp = await page.request.get(`${API}/sessions/${sessionId}/trade`)
  if (resp.status() === 404) return null
  if (!resp.ok()) throw new Error(`GET /sessions/${sessionId}/trade 失敗 (HTTP ${resp.status()})`)
  return resp.json()
}

export async function getSession(page: Page, sessionId: string) {
  const resp = await page.request.get(`${API}/sessions/${sessionId}`)
  if (!resp.ok()) throw new Error(`GET /sessions/${sessionId} 失敗 (HTTP ${resp.status()})`)
  return resp.json() as Promise<{ id: string; current_position: string; symbol: string; has_active_trade: boolean }>
}

/**
 * 指定フェーズのセッションを探して、そのセッション ID と一覧内インデックスを返す。
 * 見つからなければ null を返す。
 */
export async function findSessionForPhase(
  page: Page,
  phase: 'any' | 'holding' | 'analyzing',
): Promise<{ id: string; index: number } | null> {
  const sessions = await getSessionList(page)
  const candidates = sessions.filter(s => !s.is_settled)

  for (const s of candidates) {
    const idx = sessions.indexOf(s)

    if (phase === 'any') return { id: s.id, index: idx }

    const trade = await getActiveTrade(page, s.id)
    const isHolding = trade?.is_open === true

    if (phase === 'holding' && isHolding) return { id: s.id, index: idx }
    if (phase === 'analyzing' && !isHolding) return { id: s.id, index: idx }
  }
  return null
}

/**
 * ログイン済み状態でセッション一覧ページを開き、指定インデックスのセッションをクリックする。
 */
export async function navigateToSession(page: Page, sessionIndex: number): Promise<void> {
  await page.goto('/')
  await page.waitForSelector('.session-list-page', { timeout: 10_000 })
  await page.locator('.session-item').nth(sessionIndex).click()
  await page.waitForSelector('.session-page', { timeout: 10_000 })
}

// ---------------------------------------------------------------------------
// Chart API (window.__chartTest)
// ---------------------------------------------------------------------------

type ChartTestEntry = {
  priceToY(p: number): number | null
  yToPrice(y: number): number | null
  timeToX(t: number): number | null
  xToTime(x: number): number | null
}

declare global {
  interface Window {
    __chartTest?: Map<string, ChartTestEntry>
  }
}

export async function waitForChartTest(page: Page, tf: string, timeout = 15_000): Promise<void> {
  await page.waitForFunction(
    (tf) => window.__chartTest?.has(tf) === true,
    tf,
    { timeout },
  )
}

/** 価格 → チャートペイン内 Y 座標(px)。null なら範囲外。 */
export async function priceToY(page: Page, tf: string, price: number): Promise<number | null> {
  return page.evaluate(
    ([tf, price]) => window.__chartTest?.get(tf)?.priceToY(price) ?? null,
    [tf, price] as [string, number],
  )
}

/**
 * 対象 TF のチャートペイン上端 viewport Y を返す。
 * `priceToY` はペイン内座標なので、viewport Y = paneTop + priceToY(price)。
 */
export async function viewportY(page: Page, tf: string, price: number): Promise<number | null> {
  const paneY = await priceToY(page, tf, price)
  if (paneY == null) return null
  const paneTop = await page.evaluate((tf) => {
    const badge = Array.from(document.querySelectorAll('.tf-badge'))
      .find(el => el.textContent?.trim() === tf)
    return badge?.closest('.stacked-chart')?.getBoundingClientRect().top ?? null
  }, tf)
  if (paneTop == null) return null
  return paneTop + paneY
}

// ---------------------------------------------------------------------------
// マウス操作
// ---------------------------------------------------------------------------

/** Y 方向のドラッグ(5px 刻み)。x は固定。 */
export async function dragVertical(
  page: Page,
  x: number,
  fromY: number,
  toY: number,
): Promise<void> {
  await page.mouse.move(x, fromY)
  await page.mouse.down()
  const steps = Math.max(1, Math.ceil(Math.abs(toY - fromY) / 5))
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x, fromY + (toY - fromY) * (i / steps))
  }
  await page.mouse.up()
}

/** LWC canvas の CSS cursor を取得する。 */
export async function getCanvasCursor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.tv-lightweight-charts canvas') as HTMLCanvasElement | null
    return canvas ? getComputedStyle(canvas).cursor : ''
  })
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

/** 指定 TF のチャートペイン中央の viewport X 座標を返す。 */
export async function paneCenterX(page: Page, tf: string): Promise<number | null> {
  return page.evaluate((tf) => {
    const badge = Array.from(document.querySelectorAll('.tf-badge'))
      .find(el => el.textContent?.trim() === tf)
    const rect = badge?.closest('.stacked-chart')?.getBoundingClientRect()
    return rect ? rect.left + rect.width / 2 : null
  }, tf)
}

/** UNIX 秒 → UTC ISO 文字列の先頭 16 文字(分まで)。 */
export function toUTCMinutes(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 16)
}

/** ISO 時刻文字列から次の H1 バー開始時刻(UTC)を計算する。 */
export function nextH1BoundaryUTC(isoTime: string): Date {
  const t = new Date(isoTime)
  const next = new Date(t)
  next.setUTCMinutes(0, 0, 0)
  next.setUTCHours(t.getUTCHours() + 1)
  return next
}
