import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 300_000,
  globalTimeout: 1_800_000,
  outputDir: process.env.RDLC_DESKTOP_ARTIFACT_DIR
    ? `${process.env.RDLC_DESKTOP_ARTIFACT_DIR}/playwright`
    : '../../.vscode-test/desktop-artifacts/playwright',
  snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
  updateSnapshots: 'none',
  reporter: [['list']],
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    viewport: null,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
});
