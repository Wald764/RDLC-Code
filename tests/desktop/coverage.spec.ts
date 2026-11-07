import { test, expect } from 'playwright/test';
import { coverageFileReasons } from './coverage-assertions.js';

test('coverage: every requirement names an executable assertion in the current candidate', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const reasons = coverageFileReasons(root);
  await test.info().attach('coverage-assertion-resolution', {
    body: JSON.stringify({ reasons }, null, 2),
    contentType: 'application/json',
  });
  expect(
    reasons.length,
    `${reasons.slice(0, 10).join('\n')}\nSee the attached resolution report for all missing assertions.`,
  ).toBe(0);
});
