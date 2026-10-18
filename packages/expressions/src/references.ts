import type { SourceRange } from '@rdlc/report-model/document';

interface Position {
  readonly start: number;
  readonly end: number;
  /** Contiguous lexical segment: a comment or CDATA boundary starts a new one. */
  readonly segment: number;
}

const entities: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decode text-only element content exactly as the XML parser does (entities, CDATA,
 * line-end normalization), keeping each decoded UTF-16 unit's raw source range.
 * Child elements and processing instructions have no proven correspondence.
 */
export function decodeContent(
  source: string,
  content: SourceRange,
): { readonly text: string; readonly positions: readonly Position[] } | null {
  let text = '';
  const positions: Position[] = [];
  let segment = 0;
  let at = content.start;
  const push = (value: string, start: number, end: number) => {
    for (const unit of value) {
      for (let i = 0; i < unit.length; i++)
        positions.push({ start, end, segment });
      text += unit;
    }
  };
  const chars = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (source[i] === '\r') {
        const end = source[i + 1] === '\n' ? i + 2 : i + 1;
        push('\n', i, end);
        i = end - 1;
      } else push(source[i]!, i, i + 1);
    }
  };
  while (at < content.end) {
    if (source.startsWith('<![CDATA[', at)) {
      const close = source.indexOf(']]>', at + 9);
      if (close < 0 || close + 3 > content.end) return null;
      segment++;
      chars(at + 9, close);
      segment++;
      at = close + 3;
    } else if (source.startsWith('<!--', at)) {
      const close = source.indexOf('-->', at + 4);
      if (close < 0 || close + 3 > content.end) return null;
      segment++;
      at = close + 3;
    } else if (source[at] === '<') return null;
    else if (source[at] === '&') {
      const close = source.indexOf(';', at);
      if (close < 0 || close >= content.end) return null;
      const name = source.slice(at + 1, close);
      const code = /^#x[0-9a-fA-F]+$/.test(name)
        ? parseInt(name.slice(2), 16)
        : /^#[0-9]+$/.test(name)
          ? parseInt(name.slice(1), 10)
          : null;
      const value =
        code === null
          ? entities[name]
          : code <= 0x10ffff
            ? String.fromCodePoint(code)
            : undefined;
      if (value === undefined) return null;
      push(value, at, close + 1);
      at = close + 1;
    } else {
      let next = at;
      while (next < content.end && source[next] !== '<' && source[next] !== '&')
        next++;
      chars(at, next);
      at = next;
    }
  }
  return { text, positions };
}

/**
 * Raw source range of a decoded operand, or null when the operand is not one
 * contiguous lexical run whose decoding equals `expected`.
 */
export function rawOperandRange(
  source: string,
  content: SourceRange,
  expected: string,
  decoded: SourceRange,
): SourceRange | null {
  const result = decodeContent(source, content);
  if (
    !result ||
    result.text !== expected ||
    decoded.start < 0 ||
    decoded.end > result.text.length ||
    decoded.start >= decoded.end
  )
    return null;
  const first = result.positions[decoded.start]!;
  const last = result.positions[decoded.end - 1]!;
  for (let i = decoded.start; i < decoded.end; i++)
    if (result.positions[i]!.segment !== first.segment) return null;
  // A replaced range must not split one entity or CRLF pair.
  if (
    (decoded.start > 0 &&
      result.positions[decoded.start - 1]!.start === first.start) ||
    (decoded.end < result.positions.length &&
      result.positions[decoded.end]!.start === last.start)
  )
    return null;
  return { start: first.start, end: last.end };
}
