import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateReport } from './report-evaluation.js';
import { clipboardIntent } from './sidebar/actions.js';

test('native clipboard menus require both current body membership and capability', () => {
  const evaluation = evaluateReport({
    uri: 'test:body',
    version: 3,
    source: readFileSync('tests/fixtures/textboxes/supported.rdlc', 'utf8'),
    eol: '\n',
  });
  const body = evaluation.navigation.structure.nodes.find(
    (node) => node.kind === 'textbox',
  )!;
  assert.ok(body);
  for (const action of ['copy', 'cut', 'duplicate'] as const)
    assert.deepEqual(clipboardIntent(body, evaluation.scene, action), {
      action: 'clipboard',
      clipboard: action,
    });
  assert.throws(
    () => clipboardIntent(body, null, 'cut'),
    /eligible report body item/,
  );
  assert.throws(
    () =>
      clipboardIntent({ ...body, capabilities: [] }, evaluation.scene, 'cut'),
    /eligible report body item/,
  );
  const structural = evaluation.navigation.structure.nodes.find(
    (node) => node.kind === 'body',
  )!;
  assert.throws(
    () => clipboardIntent(structural, evaluation.scene, 'duplicate'),
    /eligible report body item/,
  );
});
