import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DESKTOP_GROUP_NAMES } from '../../scripts/desktop-matrix.js';
import { HOST_OBSERVER_TESTS, PLATFORM_SKIPS } from './host-observer-scope.js';
import {
  CANDIDATE_CELL_CHECKS,
  DESKTOP_CELL_CHECKS,
  EXPECTED_MATRIX,
  INFORMATIONAL_CHECKS,
  INFORMATIONAL_TEST_RULES,
  PINNED_CRITICAL_TESTS,
  SKIPPABLE_TEST_FILES,
  VISUAL_CELL_CHECKS,
  classifyCheck,
  classifyTest,
  exceptionAllowed,
  expectedChecks,
  matchInformationalRule,
  skipAllowed,
  testId,
} from './qa-classification.js';

const QUOTED = /^[ \t]*test(?:\.only)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gm;
const unescape = (title: string): string => title.replace(/\\(.)/g, '$1');

/**
 * Every test declaration of the real Desktop specs, per spec file. Titles may be
 * single, double or backtick quoted and tests may be nested in
 * `test.describe` (Playwright reports the bare title as `spec.title`). A
 * declaration whose title cannot be read fails the test instead of hiding a
 * test from the classification checks.
 */
function realTitles(): Map<string, string[]> {
  const titles = new Map<string, string[]>();
  const declared = /^[ \t]*test(?:\.only)?\(/gm;
  for (const file of readdirSync('tests/desktop').filter((name) =>
    name.endsWith('.spec.ts'),
  )) {
    const source = readFileSync(`tests/desktop/${file}`, 'utf8');
    const found = [...source.matchAll(QUOTED)].map((m) => unescape(m[2]!));
    assert.equal(
      found.length,
      [...source.matchAll(declared)].length,
      `${file}: every test declaration has a literal title`,
    );
    titles.set(file, found);
  }
  return titles;
}

test('title discovery reads single, double and backtick quoted titles', () => {
  const source = [
    "test('single \\' quote', async () => {});",
    'test("double", async () => {});',
    'test(`back${"tick"}`, async () => {});',
    "  test.describe('group', () => {",
    '    test(',
    "      'nested',",
    '    );',
    '  });',
    "test.skip(flag, 'not a declaration');",
  ].join('\n');
  assert.deepEqual(
    [...source.matchAll(QUOTED)].map((m) => unescape(m[2]!)),
    ["single ' quote", 'double', 'back${"tick"}', 'nested'],
  );
});

test('every informational rule is justified and matches at least one real Desktop test title', () => {
  const titles = realTitles();
  assert.ok(titles.size >= 10, 'the real spec files were found');
  const ids = new Set<string>();
  for (const rule of INFORMATIONAL_TEST_RULES) {
    assert.ok(!ids.has(rule.id), `duplicate rule ${rule.id}`);
    ids.add(rule.id);
    assert.ok(rule.justification.trim().length > 30, `${rule.id}: justify it`);
    assert.ok(
      rule.failure.length > 0 && rule.anchors.length > 0,
      `${rule.id}: no informational rule is whole-file`,
    );
    const source = readFileSync(`tests/desktop/${rule.file}`, 'utf8');
    for (const anchor of rule.anchors)
      assert.ok(
        source.includes(anchor),
        `${rule.id}: the spec no longer contains "${anchor}"`,
      );
    const real = titles.get(rule.file);
    assert.ok(real && real.length > 0, `${rule.id}: ${rule.file} has tests`);
    if (rule.titles?.length)
      for (const title of rule.titles)
        assert.ok(real.includes(title), `${rule.id}: no test "${title}"`);
    assert.ok(
      real.some((title) => matchInformationalRule(rule.file, title)),
      `${rule.id} matches a real title`,
    );
  }
  for (const check of INFORMATIONAL_CHECKS)
    assert.ok(check.justification.trim().length > 30, check.id);
});

test('the informational Desktop tests are exactly the reviewed list', () => {
  const informational: string[] = [];
  for (const [file, titles] of realTitles())
    for (const title of titles)
      if (matchInformationalRule(file, title))
        informational.push(testId(file, title));
  assert.deepEqual(informational.sort(), [
    'images.spec.ts::SC-006-timing',
    'layout.spec.ts::FR-028-scaling',
    'layout.spec.ts::FR-029-stability',
    'layout.spec.ts::SC-007-stability',
    'layout.spec.ts::US6.2-interface-scaling',
    'layout.spec.ts::US6.3-frame-stability',
    'native-drag.spec.ts::native drag: observe public TreeView custom MIME delivery and cancellation',
    'structure.spec.ts::SC-003-timing',
    'visual.spec.ts::FR-028-contrast',
    'visual.spec.ts::SC-006-contrast',
    'visual.spec.ts::US-IMG-placeholder',
    'visual.spec.ts::US-IMG-sizing-AutoSize',
    'visual.spec.ts::US-IMG-sizing-Clip',
    'visual.spec.ts::US-IMG-sizing-Fit',
    'visual.spec.ts::US-IMG-sizing-FitProportional',
    'visual.spec.ts::US6.2-themes',
  ]);
});

const ctx = (phase: string, matcher: string) =>
  `${phase}\n\nexpect(received).${matcher}(expected)\n\n`;
const BYTES = `${ctx('the report bytes are untouched by the cancelled preview', 'toBe')}Expected: true\nReceived: false`;
const SCREENSHOT =
  'US6.2 Dark reference\n\nScreenshot comparison failed:\n\n  1432 pixels (ratio 0.02 of all image pixels) are different.\n\n  Expected: /ref/dark.png\n  Received: /out/dark.png\n      Diff: /out/dark-diff.png';
const SIZE =
  'Screenshot comparison failed:\n\n  Expected an image 800px by 600px, received 801px by 600px. 480000 pixels (ratio 1.00 of all image pixels) are different.';
const CONTRAST = `Dark Report Structure: composited contrast 3.21:1 (bg #1e1e1e vs #6a6a6a) must reach 4.5:1\n\nexpect(received).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 4.5\nReceived: 3.21`;
const DRIFT = `${ctx('whole-series: the canvas origin does not move', 'toBeLessThanOrEqual')}Expected: <= 1\nReceived: 3`;
const DRIFT_100 = `${ctx('unintended canvas origin drift across 100 interactions', 'toBeLessThanOrEqual')}Expected: <= 1\nReceived: 2.5`;
const SCALE = `${ctx('the interface scale returns to the launched baseline', 'toBeLessThanOrEqual')}Expected: <= 0.005\nReceived: 1`;
const SCALE_PLAIN = `${ctx('', 'toBeLessThanOrEqual')}Expected: <= 0.005\nReceived: 0.5`;
const COVERAGE_GAP =
  'coverage gap: the driver cannot reach exactly 200% interface scale. Observed scales: 1.0000, 1.2000';
const HANDLE_DRAG = `${ctx('', 'toBeGreaterThanOrEqual')}Expected: >= 1\nReceived: 0\n\nCall Log:\n  - Timeout 5000ms exceeded while waiting on the predicate`;
const CRITICAL_MESSAGES = [
  BYTES,
  'a refused edit stays uncommitted\n\nexpect(received).toBe(expected) // Object.is equality\n\nExpected: 0\nReceived: 1',
  'Test timeout of 120000ms exceeded.',
  'Error: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator',
  'Error: expect(locator).toBeVisible() failed',
  'Desktop shutdown failed',
  "A snapshot doesn't exist at /ref/dark.png, writing actual.",
  'reference baselines are missing; generate them on the pinned reference image',
  'no edit was committed\n\nExpected: 0\nReceived: 2',
  'Expected: false\nReceived: true',
  'Error: browserType.launch: Target page, context or browser has been closed',
  '',
  'something unforeseen',
] as const;

test('visual, layout and native-drag are informational only for rendering and measurement failures', () => {
  const cases: [string, string, readonly string[]][] = [
    ['visual.spec.ts', 'US6.2-themes', [SCREENSHOT, SIZE]],
    ['visual.spec.ts', 'FR-028-contrast', [CONTRAST]],
    ['visual.spec.ts', 'SC-006-contrast', [CONTRAST]],
    ['visual.spec.ts', 'US-IMG-sizing-AutoSize', [SCREENSHOT, SIZE]],
    ['visual.spec.ts', 'US-IMG-sizing-Fit', [SCREENSHOT, SIZE]],
    ['visual.spec.ts', 'US-IMG-sizing-FitProportional', [SCREENSHOT, SIZE]],
    ['visual.spec.ts', 'US-IMG-sizing-Clip', [SCREENSHOT, SIZE]],
    ['visual.spec.ts', 'US-IMG-placeholder', [SCREENSHOT, SIZE]],
    [
      'layout.spec.ts',
      'US6.3-frame-stability',
      [DRIFT, DRIFT_100, SCALE_PLAIN],
    ],
    ['layout.spec.ts', 'SC-007-stability', [DRIFT_100]],
    ['layout.spec.ts', 'FR-029-stability', [DRIFT]],
    ['layout.spec.ts', 'FR-028-scaling', [SCALE, COVERAGE_GAP]],
    ['layout.spec.ts', 'US6.2-interface-scaling', [SCALE_PLAIN]],
    [
      'native-drag.spec.ts',
      'native drag: observe public TreeView custom MIME delivery and cancellation',
      [HANDLE_DRAG],
    ],
  ];
  for (const [file, title, messages] of cases) {
    for (const message of messages)
      assert.equal(
        classifyTest(file, title, message).severity,
        'informational',
        `${file}::${title}: ${message.split('\n')[0]}`,
      );
    for (const message of CRITICAL_MESSAGES) {
      assert.equal(
        classifyTest(file, title, message).severity,
        'critical',
        `${file}::${title}: ${message.split('\n')[0]}`,
      );
    }
    // Missing message, empty list: fail closed.
    assert.equal(classifyTest(file, title).severity, 'critical');
    assert.equal(classifyTest(file, title, []).severity, 'critical');
    // Every recorded error must match, not just one.
    assert.equal(
      classifyTest(file, title, [messages[0]!, BYTES]).severity,
      'critical',
    );
    assert.equal(
      classifyTest(file, title, [messages[0]!, messages[0]!]).severity,
      'informational',
    );
  }
  // A screenshot message is a visual signature only: not accepted elsewhere.
  assert.equal(
    classifyTest('components.spec.ts', 'US4.2-insert-once', SCREENSHOT)
      .severity,
    'critical',
  );
  assert.equal(
    classifyTest('layout.spec.ts', 'FR-028-scaling', SCREENSHOT).severity,
    'critical',
  );
});

test('end-anchored signatures: a Call Log suffix only passes for the native-drag matcher timeout', () => {
  const budget = `expect(received).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 95\nReceived: 88`;
  const poll = (reason: string) =>
    `expect(received).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 1\nReceived: 0\n\nCall Log:\n- ${reason}`;
  const drag = 'native-drag.spec.ts';
  const title =
    'native drag: observe public TreeView custom MIME delivery and cancellation';
  // Exactly what expect.poll appends (playwright expect.js invokePollMatcher).
  assert.equal(
    classifyTest(
      drag,
      title,
      poll('Timeout 5000ms exceeded while waiting on the predicate'),
    ).severity,
    'informational',
  );
  // The test ran out of time, or the text goes on: critical.
  for (const message of [
    poll('Test timeout of 120000ms exceeded'),
    `${poll('Timeout 5000ms exceeded while waiting on the predicate')}\nmore`,
    `${HANDLE_DRAG}\nTrailing text`,
  ])
    assert.equal(classifyTest(drag, title, message).severity, 'critical');
  // SC-003 is not a poll: any suffix fails closed.
  for (const suffix of [
    '\n\nCall Log:\n- Timeout 5000ms exceeded while waiting on the predicate',
    '\nextra',
  ])
    assert.equal(
      classifyTest('structure.spec.ts', 'SC-003-timing', budget + suffix)
        .severity,
      'critical',
    );
  assert.equal(
    classifyTest('structure.spec.ts', 'SC-003-timing', `${budget}\n`).severity,
    'informational',
  );
});

test('every skippable test is mapped to its real spec file and the allowlists agree', () => {
  const titles = realTitles();
  for (const [title, file] of Object.entries(SKIPPABLE_TEST_FILES))
    assert.ok(titles.get(file)?.includes(title), `${file}::${title} exists`);
  for (const title of [...HOST_OBSERVER_TESTS, ...Object.keys(PLATFORM_SKIPS)])
    assert.ok(SKIPPABLE_TEST_FILES[title], `${title} has a spec file`);
  assert.deepEqual(
    Object.keys(SKIPPABLE_TEST_FILES).sort(),
    [...HOST_OBSERVER_TESTS, ...Object.keys(PLATFORM_SKIPS)].sort(),
  );
  // file + title + platform
  assert.ok(skipAllowed('context.spec.ts', 'US5.3-two-views', 'macos-15'));
  assert.ok(
    skipAllowed('tests/desktop/context.spec.ts', 'US5.3-two-views', 'macos-15'),
  );
  assert.ok(!skipAllowed('context.spec.ts', 'US5.3-two-views', 'ubuntu-24.04'));
  assert.ok(!skipAllowed('context.spec.ts', 'US5.3-two-views', 'windows-2022'));
  assert.ok(!skipAllowed('data.spec.ts', 'US5.3-two-views', 'macos-15'));
  assert.ok(!skipAllowed('context.spec.ts', 'US5.9-new', 'macos-15'));
  assert.ok(!skipAllowed('context.spec.ts', 'toString', 'macos-15'));
  assert.ok(skipAllowed('offline.spec.ts', 'FR-014-no-fetch', 'windows-2022'));
  assert.ok(!skipAllowed('offline.spec.ts', 'FR-014-no-fetch', 'ubuntu-24.04'));
});

test('unknown and pinned tests are critical, never informational', () => {
  assert.equal(
    classifyTest('new.spec.ts', 'US9.9-anything').severity,
    'critical',
  );
  assert.equal(classifyTest('', '').severity, 'critical');
  assert.equal(classifyCheck('job:quality').severity, 'critical');
  assert.equal(classifyCheck('job:brand-new').severity, 'critical');
  assert.equal(classifyCheck('cell:probe').severity, 'critical');
  const titles = realTitles();
  for (const pinned of PINNED_CRITICAL_TESTS) {
    assert.ok(
      titles.get(pinned.file)?.includes(pinned.title),
      `pinned test exists: ${pinned.file}::${pinned.title}`,
    );
    assert.equal(matchInformationalRule(pinned.file, pinned.title), null);
    assert.equal(
      classifyTest(pinned.file, pinned.title, 'x').severity,
      'critical',
    );
  }
  // Keyboard operability and security journeys, wherever they live.
  for (const [file, title] of [
    ['accessibility.spec.ts', 'US6.1-keyboard-journey'],
    ['accessibility.spec.ts', 'FR-027-keyboard'],
    ['accessibility.spec.ts', 'SC-006-keyboard-themes'],
    ['context.spec.ts', 'SC-005-switch-races'],
    ['offline.spec.ts', 'FR-014-no-fetch'],
    ['coverage.spec.ts', titles.get('coverage.spec.ts')![0]!],
  ] as const)
    assert.equal(classifyTest(file, title, 'boom').severity, 'critical', title);
  // Paths are reduced to the spec file name.
  assert.equal(
    classifyTest('tests/desktop/visual.spec.ts', 'US6.2-themes', SCREENSHOT)
      .severity,
    'informational',
  );
});

test('only the latency budget of SC-003-timing is informational; correctness failures stay critical', () => {
  const file = 'structure.spec.ts';
  const budget =
    '\u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoBeGreaterThanOrEqual\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m\n\nExpected: >= \u001b[32m95\u001b[39m\nReceived: \u001b[31m88\u001b[39m';
  assert.equal(
    classifyTest(file, 'SC-003-timing', budget).severity,
    'informational',
  );
  assert.equal(
    classifyTest(
      file,
      'SC-003-timing',
      'expect(received).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 95\nReceived: 80',
    ).severity,
    'informational',
  );
  for (const failure of [
    undefined,
    '',
    'Expected: >= 95\nReceived: 80',
    'Error: expect(locator).toBeVisible() failed',
    'Expected: "Second, Primary, 2 selected"\nReceived: ""',
    'expect(received).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 100\nReceived: 90',
    'expect(received).toBeGreaterThanOrEqual(expected)\n\nExpected: >= 950\nReceived: 90',
    'expect(received).toBe(expected) // Object.is equality\n\nExpected: >= 95\nReceived: 90',
    'expect(received).toBe(expected)\n\nExpected: "x"\nReceived: ">= 95"',
    // Quoted source (snippet or stack) never counts.
    '  634 | ).toBeGreaterThanOrEqual(95);',
  ])
    assert.equal(
      classifyTest(file, 'SC-003-timing', failure).severity,
      'critical',
      String(failure),
    );
});

test('only the latency budgets of images SC-006-timing are informational; correctness failures stay critical', () => {
  const file = 'images.spec.ts';
  const title = 'SC-006-timing';
  const failed = (matcher: string, expected: string, received: string) =>
    `expect(received).${matcher}(expected)\n\nExpected: ${expected}\nReceived: ${received}`;
  const budget =
    '\u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoBeLessThanOrEqual\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m)\u001b[22m\n\nExpected: <= \u001b[32m100\u001b[39m\nReceived: \u001b[31m142\u001b[39m';
  for (const informational of [
    budget,
    `selection feedback p95 (ms)\n\n${failed('toBeLessThanOrEqual', '<= 100', '142')}`,
    `move feedback p95 (ms)\n\n${failed('toBeLessThanOrEqual', '<= 100', '101.5')}`,
    `a 5 MiB picture appears within 1 s (ms)\n\n${failed('toBeLessThanOrEqual', '<= 1000', '1380')}\n`,
  ])
    assert.equal(
      classifyTest(file, title, informational).severity,
      'informational',
      informational,
    );
  for (const failure of [
    undefined,
    '',
    'Expected: <= 100\nReceived: 142',
    'Error: expect(locator).toHaveCount(50) failed',
    'expect(received).toBe(expected) // Object.is equality\n\nExpected: 50\nReceived: 49',
    failed('toBeLessThanOrEqual', '<= 10', '142'),
    failed('toBeLessThanOrEqual', '<= 10000', '14200'),
    failed('toBeLessThanOrEqual', '<= 100', 'abc'),
    failed('toBeGreaterThanOrEqual', '>= 100', '90'),
    `${failed('toBeLessThanOrEqual', '<= 100', '142')}\nmore text`,
    "A snapshot doesn't exist at /ref/dark.png, writing actual.",
    '  612 | ).toBeLessThanOrEqual(100);',
  ])
    assert.equal(
      classifyTest(file, title, failure).severity,
      'critical',
      String(failure),
    );
  // The rule covers this one title of this one file.
  assert.equal(
    classifyTest(
      file,
      'US1-insert-undo',
      failed('toBeLessThanOrEqual', '<= 100', '142'),
    ).severity,
    'critical',
  );
  assert.equal(
    classifyTest(
      'structure.spec.ts',
      title,
      failed('toBeLessThanOrEqual', '<= 100', '142'),
    ).severity,
    'critical',
  );
});

test('release exceptions may only name informational checks and tests', () => {
  assert.ok(exceptionAllowed('job:visual'));
  assert.equal(exceptionAllowed('job:stability'), false);
  assert.equal(exceptionAllowed('job:changed-specs'), false);
  assert.ok(exceptionAllowed('layout.spec.ts::FR-028-scaling'));
  assert.ok(exceptionAllowed('tests/desktop/visual.spec.ts::US6.2-themes'));
  for (const id of [
    'job:quality',
    'job:validation',
    'job:canonical',
    'cell:probe',
    'components.spec.ts::US4.2-insert-once',
    'accessibility.spec.ts::US6.1-keyboard-journey',
    'FR-028-scaling',
    'keyboard',
    '',
  ])
    assert.equal(exceptionAllowed(id), false, id);
});

test('the expected evidence matrix follows ci.yml and the Desktop matrix planner', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const axis = (key: string) => {
    const found = new RegExp(`^ {8}${key}: \\[([^\\]]+)\\]`, 'm').exec(ci);
    assert.ok(found, key);
    return found[1]!
      .split(',')
      .map((part) => part.trim().replace(/^'|'$/g, ''));
  };
  assert.deepEqual([...EXPECTED_MATRIX.os], axis('os'));
  assert.deepEqual([...EXPECTED_MATRIX.vscode], axis('vscode'));
  assert.deepEqual([...EXPECTED_MATRIX.group], axis('group'));
  assert.deepEqual([...EXPECTED_MATRIX.group], DESKTOP_GROUP_NAMES);
});

test('expected cell checks follow the OS family and the core-only suites', () => {
  const ids = (os: string, group: string) =>
    expectedChecks(DESKTOP_CELL_CHECKS, os, group).map((e) => e.check.id);
  assert.deepEqual(ids('ubuntu-24.04', 'core'), [
    'install',
    'build',
    'package',
    'vscode-provisioning',
    'vscode-host',
    'linux-resources',
    'package-tests',
    'linux-environment',
    'probe',
    'e2e-functional',
    'e2e-installed',
  ]);
  assert.deepEqual(ids('windows-2022', 'context'), [
    'install',
    'build',
    'package',
    'vscode-provisioning',
    'display-windows',
    'e2e-functional',
    'e2e-installed',
  ]);
  assert.ok(ids('macos-15', 'authoring').includes('display-macos'));
  assert.ok(!ids('macos-15', 'authoring').includes('probe'));
  assert.deepEqual(
    expectedChecks(VISUAL_CELL_CHECKS, 'ubuntu-24.04', null).map((e) => e.step),
    ['install', 'build', 'provision', 'visual'],
  );
  assert.deepEqual(
    expectedChecks(CANDIDATE_CELL_CHECKS, 'ubuntu-24.04', null).map(
      (e) => e.step,
    ),
    [
      'install',
      'compile',
      'bind',
      'provision',
      'download-vscode',
      'probe',
      'installed',
      'visual',
    ],
  );
});
