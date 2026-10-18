import type {
  DocumentSnapshot,
  SourceRange,
} from '@rdlc/report-model/document';
import type { PatchPlan, SourcePatch } from '@rdlc/report-model/editing';
import { RDL_2016 } from '@rdlc/report-model/report';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { escapeText } from './textboxes.js';
import { normalizePatches } from './patches.js';

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
  namespaceDependencies: PatchPlan['namespaceDependencies'] = [],
): PatchPlan {
  const sorted = normalizePatches(snapshot, patches);
  const dependencies: PatchPlan['namespaceDependencies'][number][] = [];
  for (const dependency of namespaceDependencies) {
    const existing = dependencies.find(
      (entry) =>
        entry.nodeId === dependency.nodeId &&
        entry.prefix === dependency.prefix,
    );
    if (existing && existing.uri !== dependency.uri)
      throw new Error('Conflicting namespace dependencies.');
    if (!existing) dependencies.push(dependency);
  }
  return {
    version: snapshot.version,
    patches: sorted,
    footprint: sorted.map(({ start, end }) => ({ start, end })),
    namespaceDependencies: dependencies,
  };
}
export function composePlans(
  snapshot: DocumentSnapshot,
  plans: readonly PatchPlan[],
): PatchPlan {
  for (const plan of plans)
    if (
      plan.version !== snapshot.version ||
      plan.patches.some(
        (patch) =>
          !plan.footprint.some(
            (range) => range.start <= patch.start && range.end >= patch.end,
          ),
      )
    )
      throw new Error('Stale plan or patch outside footprint.');
  const composed = patchPlan(
    snapshot,
    plans.flatMap((plan) => plan.patches),
    plans.flatMap((plan) => plan.namespaceDependencies),
  );
  return { ...composed, footprint: plans.flatMap((plan) => plan.footprint) };
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
