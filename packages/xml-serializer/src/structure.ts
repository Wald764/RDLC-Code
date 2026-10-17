import type {
  DocumentSnapshot,
  SourceRange,
} from '@rdlc/report-model/document';
import type { PatchPlan, SourcePatch } from '@rdlc/report-model/editing';
import { RDL_2016 } from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { escapeText } from './textboxes.js';

export function child(node: XmlNode, name: string): XmlNode | null {
  const matches = node.children.filter(
    (candidate) =>
      candidate.expandedName.namespaceUri === RDL_2016 &&
      candidate.expandedName.localName === name,
  );
  if (matches.length > 1)
    throw new Error(`Duplicate ${name} is preservation-only.`);
  return matches[0] ?? null;
}
export function element(parent: XmlNode, name: string, inner: string): string {
  const binding = Object.entries(parent.namespaces).find(
    ([, uri]) => uri === RDL_2016,
  );
  if (!binding) throw new Error('No in-scope RDL namespace binding.');
  const tag = binding[0] ? `${binding[0]}:${name}` : name;
  return `<${tag}>${inner}</${tag}>`;
}
export function sourcePatch(
  snapshot: DocumentSnapshot,
  range: SourceRange,
  replacement: string,
): SourcePatch {
  return {
    ...range,
    version: snapshot.version,
    expected: snapshot.source.slice(range.start, range.end),
    replacement,
  };
}
export function insertChild(
  snapshot: DocumentSnapshot,
  parent: XmlNode,
  xml: string,
): SourcePatch {
  if (parent.closeRange)
    return sourcePatch(
      snapshot,
      { start: parent.closeRange.start, end: parent.closeRange.start },
      xml,
    );
  const opening = snapshot.source.slice(
    parent.openRange.start,
    parent.openRange.end,
  );
  return sourcePatch(
    snapshot,
    parent.openRange,
    opening.replace(/\/\s*>$/, '>') + xml + `</${parent.qualifiedName}>`,
  );
}
export function setScalar(
  snapshot: DocumentSnapshot,
  parent: XmlNode,
  name: string,
  value: string,
): SourcePatch {
  const node = child(parent, name);
  if (!node)
    return insertChild(
      snapshot,
      parent,
      element(parent, name, escapeText(value)),
    );
  if (node.children.length)
    throw new Error('Structured value is preservation-only.');
  if (node.closeRange)
    return sourcePatch(
      snapshot,
      { start: node.openRange.end, end: node.closeRange.start },
      escapeText(value),
    );
  const opening = snapshot.source.slice(
    node.openRange.start,
    node.openRange.end,
  );
  return sourcePatch(
    snapshot,
    node.openRange,
    opening.replace(/\/\s*>$/, '>') +
      escapeText(value) +
      `</${node.qualifiedName}>`,
  );
}
export function patchPlan(
  snapshot: DocumentSnapshot,
  patches: readonly SourcePatch[],
): PatchPlan {
  const sorted: SourcePatch[] = [];
  for (const patch of [...patches].sort((a, b) => a.start - b.start)) {
    const previous = sorted.at(-1);
    if (previous?.start === patch.start) {
      if (previous.end !== previous.start && patch.end !== patch.start)
        throw new Error('Overlapping structural changes.');
      sorted[sorted.length - 1] = {
        ...sourcePatch(
          snapshot,
          { start: patch.start, end: Math.max(previous.end, patch.end) },
          '',
        ),
        replacement:
          patch.start === patch.end && previous.start !== previous.end
            ? patch.replacement + previous.replacement
            : previous.replacement + patch.replacement,
      };
    } else sorted.push(patch);
  }
  return {
    version: snapshot.version,
    patches: sorted,
    footprint: sorted.map(({ start, end }) => ({ start, end })),
    namespaceDependencies: [],
  };
}
export function renameNode(
  snapshot: DocumentSnapshot,
  node: XmlNode,
  name: string,
): SourcePatch {
  const attribute = node.attributes.find(
    (attribute) =>
      attribute.expandedName.namespaceUri === '' &&
      attribute.expandedName.localName === 'Name',
  );
  if (!attribute) throw new Error('Missing Name attribute.');
  return sourcePatch(
    snapshot,
    attribute.valueRange,
    escapeText(name).replace(/"/g, '&quot;').replace(/'/g, '&apos;'),
  );
}
