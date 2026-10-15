import type { XmlToken, TokenKind } from '@rdlc/report-model/syntax';

export class SourceOnlyError extends Error {}

/** Lexical spans only: XML grammar and decoded names/values are validated by saxes. */
export function scan(source: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  let at = 0;
  while (at < source.length) {
    const start = at;
    let kind: TokenKind;
    if (at === 0 && source[at] === '\uFEFF') {
      kind = 'bom';
      at++;
    } else if (source.startsWith('<!--', at)) {
      kind = 'comment';
      at = terminated(source, at + 4, '-->');
    } else if (source.startsWith('<![CDATA[', at)) {
      kind = 'cdata';
      at = terminated(source, at + 9, ']]>');
    } else if (source.startsWith('<?', at)) {
      kind = /^<\?xml\s/.test(source.slice(at, at + 7))
        ? 'declaration'
        : 'processing-instruction';
      at = terminated(source, at + 2, '?>');
      if (
        kind === 'declaration' &&
        /version\s*=\s*(['"])1\.1\1/.test(source.slice(start, at))
      )
        throw new SourceOnlyError(
          'XML 1.1 is source-only; use XML 1.0 for visual authoring.',
        );
    } else if (source.startsWith('<!', at)) {
      throw new SourceOnlyError(
        'DTD/entity declarations are source-only and are never resolved.',
      );
    } else if (source[at] === '<') {
      kind = source[at + 1] === '/' ? 'end-tag' : 'start-tag';
      let quote = '';
      at++;
      while (at < source.length) {
        const c = source[at++];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
      }
      if (source[at - 1] !== '>' || quote)
        throw new Error('Unterminated XML tag');
    } else {
      kind = 'text';
      const next = source.indexOf('<', at);
      at = next < 0 ? source.length : next;
    }
    tokens.push({ kind, range: { start, end: at } });
  }
  return tokens;
}

function terminated(source: string, start: number, ending: string): number {
  const end = source.indexOf(ending, start);
  if (end < 0) throw new Error(`Unterminated XML ${ending}`);
  return end + ending.length;
}
