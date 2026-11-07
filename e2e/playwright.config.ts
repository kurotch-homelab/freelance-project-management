import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: '../test-results',
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Keep the issuer hostname identical to Docker's service name. Only DNS
      // resolution changes; URL, Host header and token issuer remain unchanged.
      args: ['--host-resolver-rules=MAP oidc 127.0.0.1', '--no-proxy-server'],
    },
  },
});
