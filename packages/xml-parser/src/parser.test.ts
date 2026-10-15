import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from './parser.js';

export const snapshot = (source: string, version = 1) => ({
  uri: 'untitled:test',
  version,
  source,
  eol: '\n' as const,
});
test('retains UTF-16 spans, scopes, raw attribute quotes and complete tokens', () => {
  const source =
    '\uFEFF<?xml version="1.0"?>\r\n<!--😀--><?x y?><a xmlns="urn:a" xmlns:p="urn:p" x=\'&amp;\'><p:b xmlns:p="urn:q"><![CDATA[😀<]]>&#65;</p:b></a>';
  const result = parse(snapshot(source));
  assert.equal(result.status, 'valid');
  assert.equal(
    result.tokens.map((t) => source.slice(t.range.start, t.range.end)).join(''),
    source,
  );
  assert.equal(
    result.root?.attributes.find((a) => a.qualifiedName === 'x')?.expandedName
      .namespaceUri,
    '',
  );
  assert.equal(
    result.root?.attributes.find((a) => a.qualifiedName === 'x')?.quote,
    "'",
  );
  const child = result.root?.children[0];
  assert.equal(child?.expandedName.namespaceUri, 'urn:q');
  assert.equal(child?.text, '😀<A');
  assert.equal(child?.range.start, source.indexOf('<p:b'));
  assert.equal(result.root?.range.end, source.length);
});
test('rejects malformed XML without recovery', () => {
  for (const source of [
    '<a><b></a>',
    '<a x="1" x="2"/>',
    '<a xmlns:p="u" xmlns:q="u" p:x="1" q:x="2"/>',
    '<p:a/>',
    '<a>&bad;</a>',
    '<a>&#0;</a>',
    '<a>\u0001</a>',
    '<a>\uD800</a>',
    '<a/><b/>',
    '<a>]]></a>',
  ]) {
    const result = parse(snapshot(source));
    assert.equal(result.status, 'invalid-source', source);
    assert.equal(result.root, null);
    assert.equal(result.snapshot.source, source);
  }
});
test('DTD/XML 1.1 and budgets retain source access without retrieval', () => {
  for (const source of [
    '<!DOCTYPE a SYSTEM "https://invalid.test/a.dtd"><a/>',
    '<!DOCTYPE a [<!ENTITY e SYSTEM "file:///secret">]><a>&e;</a>',
    '<?xml version="1.1"?><a/>',
    '<a>'.repeat(257) + '</a>'.repeat(257),
    '<a>' + '<b/>'.repeat(100000) + '</a>',
    '<a>' + ' '.repeat(16 * 1024 * 1024) + '</a>',
  ]) {
    const result = parse(snapshot(source));
    assert.equal(result.status, 'source-only');
    assert.equal(result.root, null);
    assert.equal(result.snapshot.source, source);
  }
  assert.equal(
    parse(
      snapshot('<a><!-- <!DOCTYPE fake> --><![CDATA[<!DOCTYPE fake>]]></a>'),
    ).status,
    'valid',
  );
});
