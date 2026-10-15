import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@rdlc/xml-parser/parser';
import { applyPlan } from '@rdlc/xml-serializer/patches';

test('cited lexical fixture has exact no-op coverage including BOM and foreign XML', () => {
  const source = readFileSync('tests/fixtures/xml/lexical.rdlc', 'utf8');
  const result = parse({
    uri: 'fixture:lexical',
    version: 4,
    source,
    eol: '\n',
  });
  assert.equal(result.status, 'valid');
  assert.equal(
    result.tokens.map((t) => source.slice(t.range.start, t.range.end)).join(''),
    source,
  );
  let end = 0;
  for (const token of result.tokens) {
    assert.equal(token.range.start, end);
    end = token.range.end;
  }
  assert.equal(end, source.length);
});

test('a declared scalar footprint preserves all foreign XML and lexical surroundings', () => {
  const source = readFileSync('tests/fixtures/xml/lexical.rdlc', 'utf8');
  const snapshot = {
    uri: 'fixture:lexical',
    version: 4,
    source,
    eol: '\n' as const,
  };
  const start = source.indexOf('2in');
  const end = start + 3;
  const candidate = applyPlan(
    snapshot,
    {
      version: 4,
      footprint: [{ start, end }],
      namespaceDependencies: [],
      patches: [
        { version: 4, start, end, expected: '2in', replacement: '30mm' },
      ],
    },
    {},
  );
  assert.equal(candidate.slice(0, start), source.slice(0, start));
  assert.equal(candidate.slice(start + 4), source.slice(end));
  assert.equal(parse({ ...snapshot, source: candidate }).status, 'valid');
});
