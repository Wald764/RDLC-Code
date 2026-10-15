import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { applyPlan } from '@rdlc/xml-serializer/patches';

/** The caller must verify the typed intention and authored rules; no default accepting verifier. */
export function verifyCandidate(
  snapshot: DocumentSnapshot,
  plan: PatchPlan,
  verifyIntendedChange: (
    candidate: XmlSyntaxDocument,
    original: XmlSyntaxDocument,
  ) => boolean,
): { readonly source: string; readonly syntax: XmlSyntaxDocument } {
  const original = parse(snapshot);
  if (original.status !== 'valid')
    throw new Error('Original XML is not safely editable');
  const scopes: Record<string, Readonly<Record<string, string>>> = {};
  const visit = (node: XmlNode) => {
    scopes[node.id] = node.namespaces;
    for (const child of node.children) visit(child);
  };
  if (original.root) visit(original.root);
  const source = applyPlan(snapshot, plan, scopes);
  const syntax = parse({ ...snapshot, source });
  if (syntax.status !== 'valid')
    throw new Error('Candidate XML is malformed or source-only');
  const candidateNodes = new Map<number, XmlNode>();
  const index = (node: XmlNode) => {
    candidateNodes.set(node.openRange.start, node);
    for (const child of node.children) index(child);
  };
  if (syntax.root) index(syntax.root);
  const translatedStart = (start: number) =>
    start +
    plan.patches
      .filter((patch) => patch.end <= start)
      .reduce(
        (delta, patch) =>
          delta + patch.replacement.length - (patch.end - patch.start),
        0,
      );
  const verifyNamespaces = (node: XmlNode) => {
    const untouched = !plan.patches.some(
      (patch) =>
        (patch.start < node.openRange.end &&
          patch.end > node.openRange.start) ||
        (patch.start === patch.end &&
          patch.start > node.openRange.start &&
          patch.start < node.openRange.end),
    );
    const candidate = candidateNodes.get(translatedStart(node.openRange.start));
    if (
      untouched &&
      (!candidate ||
        candidate.expandedName.namespaceUri !==
          node.expandedName.namespaceUri ||
        Object.entries(node.namespaces).some(
          ([prefix, uri]) => candidate.namespaces[prefix] !== uri,
        ))
    )
      throw new Error('Namespace semantics of untouched source changed');
    for (const dependency of plan.namespaceDependencies.filter(
      (dependency) => dependency.nodeId === node.id,
    ))
      if (candidate?.namespaces[dependency.prefix] !== dependency.uri)
        throw new Error('Candidate namespace dependency changed');
    for (const child of node.children) verifyNamespaces(child);
  };
  if (original.root) verifyNamespaces(original.root);
  let oldEnd = 0;
  let newEnd = 0;
  for (const patch of plan.patches) {
    const untouchedLength = patch.start - oldEnd;
    if (
      snapshot.source.slice(oldEnd, patch.start) !==
      source.slice(newEnd, newEnd + untouchedLength)
    )
      throw new Error('Untouched source changed');
    newEnd += untouchedLength + patch.replacement.length;
    oldEnd = patch.end;
  }
  if (snapshot.source.slice(oldEnd) !== source.slice(newEnd))
    throw new Error('Untouched source suffix changed');
  if (!verifyIntendedChange(syntax, original))
    throw new Error(
      'Candidate does not satisfy intended change and authored validation',
    );
  return { source, syntax };
}
