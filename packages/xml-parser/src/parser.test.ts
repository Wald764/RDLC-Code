import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractBulkText, parse } from './parser.js';
import { scan } from './scanner.js';

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

// Bulk character data (an embedded picture) bypasses the XML reader; the result must be
// indistinguishable from reading it as ordinary text.
const bulk = (length: number, seed = 'QUJD') =>
  seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
const textOf = (source: string, name: string) => {
  const result = parse(snapshot(source));
  assert.equal(result.status, 'valid', source.slice(0, 80));
  const node = result.root?.children.find((c) => c.qualifiedName === name);
  return { result, node };
};

test('bulk base64 text keeps its exact text, ranges and tokens', () => {
  const run = bulk(20000);
  const source = `<a><d>${run}</d><e>${run}</e><f>small</f></a>`;
  const { result, node } = textOf(source, 'd');
  assert.equal(node?.text, run);
  assert.equal(result.root?.children[1]?.text, run);
  assert.equal(result.root?.children[2]?.text, 'small');
  assert.equal(node?.range.start, source.indexOf('<d>'));
  assert.equal(node?.closeRange?.end, source.indexOf('</d>') + 4);
  assert.equal(
    result.tokens.map((t) => source.slice(t.range.start, t.range.end)).join(''),
    source,
  );
});

test('bulk text normalizes line ends and keeps whitespace like the reader does', () => {
  const lines = bulk(30, 'QUJD').replace(/(.{10})/g, '$1\r\n');
  const run = `\r\n  ${lines.repeat(300)}\r  \t\n`;
  const { node } = textOf(`<a><d>${run}</d></a>`, 'd');
  assert.equal(node?.text, run.replace(/\r\n?/g, '\n'));
});

test('bulk text mixed with comments, CDATA and entities in one element', () => {
  const run = bulk(8192);
  const { node } = textOf(
    `<a><d>x&amp;${'y'.repeat(10)}<!--c-->${run}<![CDATA[<z>]]>${run}</d></a>`,
    'd',
  );
  assert.equal(node?.text, `x&${'y'.repeat(10)}${run}<z>${run}`);
});

test('text that is not plain base64 or whitespace stays on the reader path', () => {
  const entity = `${bulk(5000)}&amp;${bulk(5000)}`;
  assert.equal(
    textOf(`<a><d>${entity}</d></a>`, 'd').node?.text,
    entity.replace('&amp;', '&'),
  );
  const spaces = ' '.repeat(6000);
  assert.equal(textOf(`<a><d>${spaces}</d></a>`, 'd').node?.text, spaces);
  const accents = `${bulk(5000)}é${bulk(5000)}`;
  assert.equal(textOf(`<a><d>${accents}</d></a>`, 'd').node?.text, accents);
});

test('a source that already uses the private-use markers still parses', () => {
  const run = bulk(6000);
  const markers = '';
  const { node, result } = textOf(`<a><b>${markers}</b><d>${run}</d></a>`, 'd');
  assert.equal(node?.text, run);
  assert.equal(result.root?.children[0]?.text, markers);
});

test('malformed XML around bulk text reports the reader error of the full source', () => {
  const run = bulk(9000);
  for (const source of [
    `<a><d>${run}</a>`,
    `<a><d>${run}</d></a>${run}`,
    `${run}<a/>`,
    `<a x="1" x="2"><d>${run}</d></a>`,
  ]) {
    const result = parse(snapshot(source));
    assert.equal(result.status, 'invalid-source');
    assert.equal(result.root, null);
    assert.equal(result.snapshot.source, source);
  }
  // Positions in the message are those of the real source, not of the shortened input.
  const broken = parse(snapshot(`<a><d>${run}</d><b>&bad;</b></a>`));
  assert.match(
    broken.diagnostics[0]!.message,
    new RegExp(`^1:${`<a><d>${run}</d><b>&bad;`.length}: `),
  );
});

test('a character reference to a marker cannot be mistaken for a replaced run', () => {
  const run = bulk(6000);
  // Each spelling decodes to U+E000 in the reader; none of them is a literal marker.
  const refs = '&#xE000;&#xe000;&#57344;&#x00E000;&#0057344;';
  const source = `<a><b>${refs}</b><d>${run}</d></a>`;
  assert.ok(!source.includes('\uE000'));
  const { node, result } = textOf(source, 'd');
  assert.equal(node?.text, run);
  assert.equal(result.root?.children[0]?.text, '\uE000'.repeat(5));
  // The marker is chosen past every referenced code point, so no fallback re-read is needed.
  const bulked = extractBulkText(source, scan(source));
  assert.equal(bulked?.marker, '\uE001');
  assert.deepEqual(bulked?.runs, [run]);
});

test('the marker is the first private-use character the source neither contains nor references', () => {
  const run = bulk(5000);
  const used = (source: string) =>
    extractBulkText(source, scan(source))?.marker;
  assert.equal(used(`<a><d>${run}</d></a>`), '\uE000');
  assert.equal(used(`<a><b>\uE000</b><d>${run}</d></a>`), '\uE001');
  assert.equal(used(`<a><b>&#xE001;\uE000</b><d>${run}</d></a>`), '\uE002');
  assert.equal(
    used(`<a><b>\uE000\uE001\uE002&#xE003;</b><d>${run}</d></a>`),
    undefined,
  );
  // Unrelated references do not disturb the choice.
  assert.equal(
    used(`<a><b>&#10;&amp;&#xE0000;</b><d>${run}</d></a>`),
    '\uE000',
  );
  // Whatever is chosen, the parse itself is right.
  const { node } = textOf(`<a><b>\uE000</b><d>${run}</d></a>`, 'd');
  assert.equal(node?.text, run);
});
