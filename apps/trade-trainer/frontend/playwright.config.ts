import { defineConfig, devices } from '@playwright/test'

/**
 * 前提: frontend(:5173) と backend(:8001) が起動済みであること。
 * 実行: npm run test:e2e
 * 認証: E2E_PASSWORD 環境変数または .env.e2e でパスワードを設定する。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  reporter: 'list',
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
