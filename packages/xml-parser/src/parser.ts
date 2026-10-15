import { SaxesParser } from 'saxes';
import type { SaxesTagNS } from 'saxes';
import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type {
  XmlAttribute,
  XmlNode,
  XmlSyntaxDocument,
  XmlToken,
} from '@rdlc/report-model/syntax';
import { scan, SourceOnlyError } from './scanner.js';

type MutableNode = { -readonly [K in keyof XmlNode]: XmlNode[K] } & {
  children: MutableNode[];
};

export function parse(snapshot: DocumentSnapshot): XmlSyntaxDocument {
  let tokens: XmlToken[] = [];
  try {
    if (
      snapshot.source.length > 16 * 1024 * 1024 ||
      new TextEncoder().encode(snapshot.source).length > 16 * 1024 * 1024
    )
      throw new SourceOnlyError(
        'Visual parsing exceeds the proposed 16 MiB source budget.',
      );
    tokens = scan(snapshot.source);
    const opens = tokens.filter((t) => t.kind === 'start-tag');
    const closes = tokens.filter((t) => t.kind === 'end-tag');
    const stack: MutableNode[] = [];
    let count = 0;
    let closeIndex = 0;
    let root: MutableNode | null = null;
    const parser = new SaxesParser({
      xmlns: true,
      defaultXMLVersion: '1.0',
      forceXMLVersion: true,
    });
    parser.on('error', (error) => {
      throw error;
    });
    parser.on('doctype', () => {
      throw new SourceOnlyError('DTD declarations are disabled.');
    });
    parser.on('xmldecl', (declaration) => {
      if (declaration.version !== '1.0')
        throw new SourceOnlyError('Only XML 1.0 is supported.');
    });
    parser.on('opentag', (tag: SaxesTagNS) => {
      if (++count > 100000 || stack.length >= 256)
        throw new SourceOnlyError(
          'Visual parsing exceeds the proposed depth 256 / 100,000-element budget.',
        );
      const token = opens[count - 1];
      if (!token) throw new Error('Lexical/event open-tag mismatch');
      const raw = snapshot.source.slice(token.range.start, token.range.end);
      if (raw.slice(1).match(/^[^\s/>]+/)?.[0] !== tag.name)
        throw new Error('Lexical/event name mismatch');
      const attributes: XmlAttribute[] = [];
      const attrPattern = /([^\s=<>/]+)\s*=\s*(["'])([\s\S]*?)\2/g;
      const attrStart = 1 + tag.name.length;
      for (const match of raw.slice(attrStart).matchAll(attrPattern)) {
        const name = match[1]!;
        const attribute = tag.attributes[name];
        if (!attribute || typeof attribute === 'string')
          throw new Error('Lexical/event attribute mismatch');
        const start = token.range.start + attrStart + match.index;
        const valueStart = start + match[0].indexOf(match[2]!) + 1;
        attributes.push({
          qualifiedName: name,
          expandedName: {
            namespaceUri: attribute.uri,
            localName: attribute.local,
          },
          nameRange: { start, end: start + name.length },
          valueRange: { start: valueStart, end: valueStart + match[3]!.length },
          range: { start, end: start + match[0].length },
          quote: match[2] as '"' | "'",
          value: attribute.value,
        });
      }
      if (attributes.length !== Object.keys(tag.attributes).length)
        throw new Error('Lexical/event attribute coverage mismatch');
      const parent = stack.at(-1);
      const node: MutableNode = {
        id: `${snapshot.version}:${count}`,
        qualifiedName: tag.name,
        expandedName: { namespaceUri: tag.uri, localName: tag.local },
        range: { start: token.range.start, end: token.range.end },
        openRange: token.range,
        closeRange: null,
        parentId: parent?.id ?? null,
        children: [],
        attributes,
        namespaces: {
          xml: 'http://www.w3.org/XML/1998/namespace',
          ...parent?.namespaces,
          ...tag.ns,
        },
        text: '',
      };
      if (parent) parent.children.push(node);
      else root = node;
      stack.push(node);
    });
    parser.on('text', (text) => {
      const node = stack.at(-1);
      if (node) node.text += text;
    });
    parser.on('cdata', (text) => {
      const node = stack.at(-1);
      if (node) node.text += text;
    });
    parser.on('closetag', (tag) => {
      const node = stack.pop();
      if (!node || node.qualifiedName !== tag.name)
        throw new Error('Lexical/event stack mismatch');
      if (!tag.isSelfClosing) {
        const token = closes[closeIndex++];
        if (
          !token ||
          snapshot.source
            .slice(token.range.start + 2, token.range.end - 1)
            .trim() !== tag.name
        )
          throw new Error('Lexical/event close-tag mismatch');
        node.closeRange = token.range;
        node.range = { start: node.range.start, end: token.range.end };
      }
    });
    parser.write(snapshot.source).close();
    if (count !== opens.length || closeIndex !== closes.length || stack.length)
      throw new Error('Incomplete lexical/event reconciliation');
    return freeze({
      snapshot: { ...snapshot },
      root,
      tokens,
      diagnostics: [],
      status: 'valid',
    });
  } catch (error) {
    const sourceOnly = error instanceof SourceOnlyError;
    return freeze({
      snapshot: { ...snapshot },
      root: null,
      tokens,
      status: sourceOnly ? 'source-only' : 'invalid-source',
      diagnostics: [
        {
          code: sourceOnly ? 'XML_SOURCE_ONLY' : 'XML_MALFORMED',
          category: sourceOnly ? 'unsupported' : 'malformed-xml',
          severity: 'error',
          range: { start: 0, end: snapshot.source.length },
          message: error instanceof Error ? error.message : 'Invalid XML',
          correctiveAction:
            'Open the source editor to inspect or correct the document.',
          blockedOperations: ['visual-edit'],
        },
      ],
    });
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
