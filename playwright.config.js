import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    channel: 'msedge',
    baseURL: 'http://127.0.0.1:8899',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'node server.mjs',
    env: {
      PDF_MERGER_NO_OPEN: '1',
      PDF_MERGER_PORT: '8899',
    },
    url: 'http://127.0.0.1:8899/',
    reuseExistingServer: false,
    timeout: 20000,
  },
});
