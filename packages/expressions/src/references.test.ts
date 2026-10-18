import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@rdlc/xml-parser/parser';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { analyze } from './analyze.js';
import { decodeContent, rawOperandRange } from './references.js';

function value(xml: string): { source: string; node: XmlNode } {
  const source = `<Value>${xml}</Value>`;
  const node = parse({ uri: 'test:', version: 1, source, eol: '\n' }).root!;
  return { source, node };
}
const inner = (node: XmlNode) => ({
  start: node.openRange.end,
  end: node.closeRange!.start,
});
function operand(xml: string, index = 0) {
  const { source, node } = value(xml);
  const reference = analyze(node.text).references[index]!;
  const range = rawOperandRange(
    source,
    inner(node),
    node.text,
    reference.nameRange!,
  );
  return range && source.slice(range.start, range.end);
}

test('decodes entities, CDATA and CRLF exactly as the parser does', () => {
  for (const xml of [
    '=ReportItems!A.Value &amp; &#x22;x&#34;',
    '<![CDATA[=ReportItems!A.Value & "<x>"]]>',
    'a\r\nb\rc<!-- note -->d',
    '&#x1F600;&lt;&gt;&apos;',
  ]) {
    const { source, node } = value(xml);
    assert.equal(decodeContent(source, inner(node))!.text, node.text, xml);
  }
  const { source, node } = value('a<?pi x?>b');
  assert.equal(decodeContent(source, inner(node)), null);
});

test('maps decoded operands to raw ranges through entities and CDATA', () => {
  assert.equal(operand('=ReportItems!Title.Value &amp; "x"'), 'Title');
  assert.equal(operand('<![CDATA[=ReportItems!Title.Value & "x"]]>'), 'Title');
  assert.equal(
    operand('=Sum(Fields!A.Value, &quot;Orders&quot;)', 1),
    'Orders',
  );
  assert.equal(operand('=ReportItems!Número.Value'), 'Número');
  assert.equal(operand('=ReportItems!&#84;itle.Value'), '&#84;itle');
  // Split across CDATA/text or a comment: no single lossless rewrite exists.
  assert.equal(operand('=ReportItems!Ti<![CDATA[tle]]>.Value'), null);
  assert.equal(operand('=ReportItems!Ti<!-- c -->tle.Value'), null);
});
