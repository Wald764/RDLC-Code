import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'playwright/test';
import { coverageAssertionReasons } from './coverage-assertions.js';
import type { CoverageRef } from './evidence.js';

test('coverage: every requirement names an executable assertion in the current candidate', async () => {
  const root = process.env.RDLC_DESKTOP_ROOT ?? process.cwd();
  const coverage = JSON.parse(
    readFileSync(resolve(root, 'tests/desktop/coverage.json'), 'utf8'),
  ) as CoverageRef;
  const reasons = coverageAssertionReasons(root, coverage);
  await test.info().attach('coverage-assertion-resolution', {
    body: JSON.stringify({ reasons }, null, 2),
    contentType: 'application/json',
  });
  expect(
    reasons.length,
    `${reasons.slice(0, 10).join('\n')}\nSee the attached resolution report for all missing assertions.`,
  ).toBe(0);
});
