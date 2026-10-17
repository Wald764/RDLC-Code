import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validColor } from './textboxes.js';

test('RDL colors require a known name or a six/eight-digit hexadecimal value', () => {
  for (const value of [
    'Red',
    'red',
    'RED',
    'LightGoldenrodYellow',
    'MenuHighlight',
    '#112233',
    '#aAbBcC',
    '#80112233',
  ])
    assert.equal(validColor(value), true, value);
  for (const value of [
    '',
    'DefinitelyNotAColor',
    'Redd',
    'rebeccapurple',
    ' Red ',
    '#123',
    '#1234567',
    '#GG1122',
    'rgb(1,2,3)',
    '=Fields!Color.Value',
  ])
    assert.equal(validColor(value), false, value);
});
