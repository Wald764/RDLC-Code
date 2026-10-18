import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  length,
  validatePage,
  validateName,
  uniqueName,
  nextName,
  validateMutation,
} from './validate.js';

test('lengths preserve units and use 96 CSS px/in only for geometry', () => {
  assert.deepEqual(length('72pt'), { raw: '72pt', pixels: 96 });
  for (const raw of ['1in', '6pc', '25.4mm', '2.54cm'])
    assert.ok(Math.abs(length(raw)!.pixels - 96) < 1e-8);
  for (const raw of [
    'NaNin',
    'Infinityin',
    '1e2in',
    '12px',
    '=Fields!A.Value',
    '1.in',
    '.5in',
  ])
    assert.equal(length(raw), null);
});
test('page requires positive printable area with nonnegative margins', () => {
  const page = {
    width: '8in',
    height: '10in',
    top: '1in',
    right: '1in',
    bottom: '1in',
    left: '1in',
  };
  assert.equal(validatePage(page).length, 0);
  for (const change of [
    { width: '0in' },
    { left: '-1in' },
    { left: '7in' },
    { bottom: '9in' },
  ])
    assert.ok(validatePage({ ...page, ...change }).length > 0);
});
test('case-sensitive names retain existing Unicode and generate ASCII CLS identifiers', () => {
  assert.ok(validateName('Élément', ['Element']));
  assert.ok(validateName('Ⅵalue', []));
  assert.ok(validateName('Item', ['item']));
  assert.equal(validateName('Item', ['Item']), false);
  assert.equal(validateName('1Item', []), false);
  assert.equal(uniqueName('Textbox', ['Textbox', 'Textbox1']), 'Textbox2');
});
test('nextName numbers from 1, fills gaps and never returns the bare stem', () => {
  assert.equal(nextName('Textbox', []), 'Textbox1');
  assert.equal(nextName('Textbox', ['Textbox']), 'Textbox1');
  assert.equal(nextName('Textbox', ['Textbox1', 'Textbox3']), 'Textbox2');
  assert.equal(nextName('Table', ['Table1', 'Textbox2']), 'Table2');
  // Any report item kind reserves the name, e.g. a preserved Rectangle.
  assert.equal(nextName('Textbox', ['Textbox1', 'Textbox2']), 'Textbox3');
  assert.throws(() => nextName('1bad', []));
  assert.throws(() => nextName('Bad-Name', []));
});
test('incomplete reference analysis blocks destructive changes but allows unrelated safe edits', () => {
  assert.equal(
    validateMutation({
      operation: 'move',
      capability: true,
      targetName: 'A',
      references: [],
      complete: false,
    }).length,
    0,
  );
  assert.ok(
    validateMutation({
      operation: 'delete',
      capability: true,
      targetName: 'A',
      references: [],
      complete: false,
    }).length,
  );
  assert.ok(
    validateMutation({
      operation: 'rename',
      capability: true,
      targetName: 'A',
      references: [
        {
          kind: 'field',
          name: 'A',
          range: { start: 0, end: 1 },
          confidence: 'static',
        },
      ],
      complete: true,
    }).length,
  );
  assert.ok(
    validateMutation({
      operation: 'move',
      capability: false,
      targetName: 'A',
      references: [],
      complete: true,
    }).length,
  );
});
