import type {
  ExpressionValue,
  Reference,
} from '@rdlc/report-model/expressions';

interface Token {
  text: string;
  start: number;
  end: number;
  kind: 'identifier' | 'number' | 'string' | 'symbol';
}

export function analyze(
  text: string,
  groups: readonly string[] = [],
): ExpressionValue {
  if (!text.startsWith('='))
    return { text, classification: 'literal', references: [], complete: true };
  const references: Reference[] = [];
  const tokens: Token[] = [];
  let valid = text.length <= 65536;
  let at = 1;
  while (valid && at < text.length) {
    if (/\s/.test(text[at]!)) {
      at++;
      continue;
    }
    const start = at;
    if (text[at] === '"') {
      at++;
      let decoded = '';
      let closed = false;
      while (at < text.length) {
        if (text[at] === '"') {
          at++;
          if (text[at] === '"') {
            decoded += '"';
            at++;
          } else {
            closed = true;
            break;
          }
        } else decoded += text[at++];
      }
      if (!closed) valid = false;
      tokens.push({ text: decoded, start, end: at, kind: 'string' });
    } else {
      const id = text.slice(at).match(/^[\p{L}_][\p{L}\p{N}\p{M}_]*/u)?.[0];
      const number = text
        .slice(at)
        .match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0];
      const value = id ?? number ?? text[at]!;
      at += value.length;
      tokens.push({
        text: value,
        start,
        end: at,
        kind: id ? 'identifier' : number ? 'number' : 'symbol',
      });
    }
    if (tokens.length > 8192) valid = false;
  }
  const is = (index: number, value: string) =>
    tokens[index]?.text.toLowerCase() === value.toLowerCase();
  for (let i = 0; i < tokens.length; i++) {
    const name = tokens[i + 2];
    if (
      is(i, 'Fields') &&
      is(i + 1, '!') &&
      name?.kind === 'identifier' &&
      is(i + 3, '.') &&
      is(i + 4, 'Value')
    )
      references.push({
        kind: 'field',
        name: name.text,
        range: { start: tokens[i]!.start, end: tokens[i + 4]!.end },
        confidence: 'static',
      });
  }
  let cursor = 0;
  function primary(depth: number): boolean {
    if (depth > 64) return false;
    const token = tokens[cursor];
    if (!token) return false;
    if (['+', '-', 'not'].includes(token.text.toLowerCase())) {
      cursor++;
      return primary(depth + 1);
    }
    if (
      token.kind === 'number' ||
      token.kind === 'string' ||
      /^(true|false|nothing)$/i.test(token.text)
    ) {
      cursor++;
      return true;
    }
    if (
      is(cursor, 'Fields') &&
      is(cursor + 1, '!') &&
      tokens[cursor + 2]?.kind === 'identifier' &&
      is(cursor + 3, '.') &&
      is(cursor + 4, 'Value')
    ) {
      cursor += 5;
      return true;
    }
    if (token.text === '(') {
      cursor++;
      if (!expression(depth + 1) || !is(cursor, ')')) return false;
      cursor++;
      return true;
    }
    if (is(cursor, 'Sum') && is(cursor + 1, '(')) {
      cursor += 2;
      if (!expression(depth + 1) || !is(cursor, ',')) return false;
      const scope = tokens[++cursor];
      if (scope?.kind !== 'string' || !scope.text) return false;
      references.push({
        kind: groups.includes(scope.text) ? 'group' : 'dataset',
        name: scope.text,
        range: { start: scope.start, end: scope.end },
        confidence: 'static',
      });
      cursor++;
      if (!is(cursor, ')')) return false;
      cursor++;
      return true;
    }
    return false;
  }
  function expression(depth: number): boolean {
    if (!primary(depth)) return false;
    while (
      tokens[cursor] &&
      /^(?:[+\-*/&=<>]|and|or|mod)$/i.test(tokens[cursor]!.text)
    ) {
      cursor++;
      if (!primary(depth)) return false;
    }
    return true;
  }
  const complete = valid && expression(0) && cursor === tokens.length;
  return { text, classification: 'expression', references, complete };
}

const expressionProperties = new Set([
  'Value',
  'Hidden',
  'CommandText',
  'FilterExpression',
  'FilterValue',
  'GroupExpression',
  'SortExpression',
  'Bookmark',
  'ToolTip',
  'DocumentMapLabel',
  'Color',
  'BackgroundColor',
  'FontSize',
  'FontFamily',
  'FontWeight',
  'FontStyle',
  'TextAlign',
  'Width',
  'Height',
  'Left',
  'Top',
]);

export function analyzeProperties(
  properties: readonly { readonly name: string; readonly value: string }[],
): { readonly references: readonly Reference[]; readonly complete: boolean } {
  const analyses = properties.map((property) =>
    expressionProperties.has(property.name)
      ? analyze(property.value)
      : { references: [], complete: false },
  );
  return {
    references: analyses.flatMap((a) => a.references),
    complete: analyses.every((a) => a.complete),
  };
}
