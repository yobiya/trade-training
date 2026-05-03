import { defineConfig, devices } from '@playwright/test'

/**
 * 前提: frontend と backend が起動済みであること。
 * 実行: npm run test:e2e
 * 認証: E2E_PASSWORD 環境変数でパスワードを設定する。
 * ポート切替:
 *   dev     (デフォルト): PLAYWRIGHT_BASE_URL 未設定 → http://localhost:5173
 *   release             : PLAYWRIGHT_BASE_URL=http://localhost:4173 npm run test:e2e
 */
// PLAYWRIGHT_BASE_URL 環境変数は Playwright が自動的に baseURL として使用する。
const BASE_URL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
