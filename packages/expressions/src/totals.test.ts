import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldBinding, sumExpression } from './totals.js';
import { analyze } from './analyze.js';

test('field and Sum authoring uses exact unevaluated explicit scopes', () => {
  assert.equal(fieldBinding('Amount'), '=Fields!Amount.Value');
  assert.equal(
    sumExpression('Amount', 'Orders'),
    '=Sum(Fields!Amount.Value, "Orders")',
  );
  const subtotal = sumExpression('Amount', 'ByCustomer');
  assert.equal(analyze(subtotal, ['ByCustomer']).complete, true);
  assert.deepEqual(
    analyze(subtotal, ['ByCustomer']).references.map((ref) => [
      ref.kind,
      ref.name,
    ]),
    [
      ['field', 'Amount'],
      ['group', 'ByCustomer'],
    ],
  );
  assert.equal(analyze('=Fields(Parameters!Name.Value).Value').complete, false);
  assert.throws(() => fieldBinding('A).Value'));
  assert.throws(() => sumExpression('Amount', 'Orders"'));
});
