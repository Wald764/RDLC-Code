import type { DocumentSnapshot } from '@rdlc/report-model/document';
import type { PatchPlan } from '@rdlc/report-model/editing';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import { parse } from '@rdlc/xml-parser/parser';
import { applyPlan } from '@rdlc/xml-serializer/patches';
import { projectReport } from '@rdlc/xml-parser/project-report';
import { acceptedGeometry, type LayoutChange } from '@rdlc/validation/layout';
import { toPoints } from '@rdlc/report-model/geometry';
import { RDL_2016 } from '@rdlc/report-model/report';
import type { CaptureRoot } from '@rdlc/report-model/clipboard';
import type { Bounds } from '@rdlc/report-model/scene';
import { analyze } from '@rdlc/expressions/analyze';
import { inertAnnotation } from '@rdlc/validation/clipboard';

/** Independently prove geometry and byte-exact non-geometry content, even in edited parents. */
export function verifyLayoutCandidate(
  original: XmlSyntaxDocument,
  candidate: XmlSyntaxDocument,
  changes: readonly LayoutChange[],
): boolean {
  const before = projectReport(original),
    after = projectReport(candidate);
  if (after.status !== 'editable') return false;
  const oldMasks: { start: number; end: number }[] = [],
    newMasks: { start: number; end: number }[] = [];
  const mask = (old: XmlNode, next: XmlNode, name: string) => {
    const find = (node: XmlNode) =>
      node.children.filter(
        (c) =>
          c.expandedName.namespaceUri === RDL_2016 &&
          c.expandedName.localName === name,
      );
    const a = find(old),
      b = find(next);
    if (a.length > 1 || b.length !== 1 || b[0]!.children.length) return false;
    if (a.length) {
      if (a[0]!.children.length) return false;
      if (
        a[0]!.closeRange &&
        (original.snapshot.source.slice(
          a[0]!.openRange.start,
          a[0]!.openRange.end,
        ) !==
          candidate.snapshot.source.slice(
            b[0]!.openRange.start,
            b[0]!.openRange.end,
          ) ||
          !b[0]!.closeRange ||
          original.snapshot.source.slice(
            a[0]!.closeRange.start,
            a[0]!.closeRange.end,
          ) !==
            candidate.snapshot.source.slice(
              b[0]!.closeRange!.start,
              b[0]!.closeRange!.end,
            ))
      )
        return false;
      const annotations = (syntax: XmlSyntaxDocument, node: XmlNode) =>
        syntax.tokens
          .filter(
            (token) =>
              ['comment', 'processing-instruction'].includes(token.kind) &&
              token.range.start >= node.range.start &&
              token.range.end <= node.range.end,
          )
          .map((token) =>
            syntax.snapshot.source.slice(token.range.start, token.range.end),
          );
      if (
        JSON.stringify(annotations(original, a[0]!)) !==
        JSON.stringify(annotations(candidate, b[0]!))
      )
        return false;
      oldMasks.push(a[0]!.range);
    } else if (b[0]!.attributes.length) return false;
    newMasks.push(b[0]!.range);
    return true;
  };
  for (const change of changes) {
    const index = change.table
      ? before.tables.findIndex((t) => t.node.id === change.item.node.id)
      : before.textboxes.findIndex((t) => t.node.id === change.item.node.id);
    const next = change.table ? after.tables[index] : after.textboxes[index];
    if (!next) return false;
    const geometry = acceptedGeometry(after, next, change.table);
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      const expected = change.values[key] ?? change.original[key].points;
      const actual = geometry[key].points;
      if (
        expected === null
          ? actual !== null
          : actual === null || Math.abs(expected - actual) > 0.01
      )
        return false;
      const materialized =
        !change.table &&
        ((key === 'width' && change.values.left !== undefined) ||
          (key === 'height' && change.values.top !== undefined)) &&
        change.original[key].provenance === 'derived';
      if (change.values[key] !== undefined || materialized) {
        if (
          change.table &&
          (key === 'width' || key === 'height') &&
          change.item.bounds[key] === null
        ) {
          if (next.bounds[key] !== null) return false;
        } else if (
          !mask(
            change.item.node,
            next.node,
            key[0]!.toUpperCase() + key.slice(1),
          )
        )
          return false;
      }
    }
    if (change.table) {
      const oldTable = before.tables[index]!,
        newTable = after.tables[index]!;
      for (const [key, name, a, b] of [
        [
          'width',
          'Width',
          oldTable.columns.map((c) => ({ node: c.node, raw: c.width })),
          newTable.columns.map((c) => ({ node: c.node, raw: c.width })),
        ],
        [
          'height',
          'Height',
          oldTable.rows.map((r) => ({ node: r.node, raw: r.height })),
          newTable.rows.map((r) => ({ node: r.node, raw: r.height })),
        ],
      ] as const) {
        if (change.values[key] === undefined) continue;
        if (a.length !== b.length) return false;
        const oldSum = a.reduce((s, c) => s + toPoints(c.raw)!, 0),
          newSum = b.reduce((s, c) => s + toPoints(c.raw)!, 0);
        if (Math.abs(newSum - change.values[key]!) > 0.01) return false;
        for (let i = 0; i < a.length; i++) {
          if (
            !(toPoints(b[i]!.raw)! > 0) ||
            Math.abs(
              toPoints(b[i]!.raw)! -
                (toPoints(a[i]!.raw)! * change.values[key]!) / oldSum,
            ) > 0.01 ||
            !mask(a[i]!.node, b[i]!.node, name)
          )
            return false;
        }
      }
    }
  }
  const stripped = (syntax: XmlSyntaxDocument, masks: typeof oldMasks) => {
    let source = syntax.snapshot.source;
    for (const range of masks.sort((a, b) => b.start - a.start))
      source = source.slice(0, range.start) + source.slice(range.end);
    return source;
  };
  return stripped(original, oldMasks) === stripped(candidate, newMasks);
}

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
    // Explicit structural replacements own their descendants; untouched siblings still reconcile.
    if (
      plan.patches.some(
        (patch) =>
          patch.start <= node.range.start &&
          patch.end >= node.range.end &&
          patch.end > patch.start,
      )
    )
      return;
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

export interface InsertedExpectation {
  readonly root: CaptureRoot;
  /** Candidate offset of the inserted root. */
  readonly start: number;
  readonly fragment: string;
  readonly bounds: Bounds;
}

/**
 * Semantic proof for clipboard candidates: each inserted subtree equals its capture
 * transformation in expanded names, namespace meaning, identities, references and
 * geometry; removed roots are gone; names stay unique.
 */
export function verifyClipboardCandidate(
  original: XmlSyntaxDocument,
  candidate: XmlSyntaxDocument,
  expected: {
    readonly inserted: readonly InsertedExpectation[];
    readonly names: ReadonlyMap<string, string>;
    readonly removed: readonly XmlNode[];
  },
): boolean {
  const before = projectReport(original),
    after = projectReport(candidate);
  if (after.status !== 'editable' || !after.section) return false;
  const rename = (name: string) => expected.names.get(name) ?? name;
  const byStart = new Map<number, XmlNode>();
  const index = (node: XmlNode) => {
    byStart.set(node.range.start, node);
    node.children.forEach(index);
  };
  if (candidate.root) index(candidate.root);
  const body = after.section.node.children.find(
    (c) =>
      c.expandedName.namespaceUri === RDL_2016 &&
      c.expandedName.localName === 'Body',
  );
  const items = body?.children.find(
    (c) =>
      c.expandedName.namespaceUri === RDL_2016 &&
      c.expandedName.localName === 'ReportItems',
  );
  const geometryNames = ['Left', 'Top', 'Width', 'Height'];
  const same = (a: XmlNode['expandedName'], b: XmlNode['expandedName']) =>
    a.namespaceUri === b.namespaceUri && a.localName === b.localName;
  const attributes = (node: XmlNode) =>
    node.attributes.filter(
      (a) =>
        a.qualifiedName !== 'xmlns' &&
        a.expandedName.namespaceUri !== 'http://www.w3.org/2000/xmlns/',
    );
  const expectedText = (reference: XmlNode, source: string): string => {
    const text = reference.text;
    if (inertAnnotation(reference, source)) return text;
    if (
      reference.expandedName.namespaceUri === RDL_2016 &&
      ['ToggleItem', 'RepeatWith', 'Scope'].includes(
        reference.expandedName.localName,
      )
    )
      return rename(text);
    if (!text.trimStart().startsWith('=')) return text;
    const lead = text.length - text.trimStart().length;
    let result = text;
    for (const r of [...analyze(text.trimStart()).references].reverse())
      if (r.kind !== 'field' && r.nameRange && rename(r.name) !== r.name)
        result =
          result.slice(0, r.nameRange.start + lead) +
          rename(r.name) +
          result.slice(r.nameRange.end + lead);
    return result;
  };
  const compare = (
    reference: XmlNode,
    node: XmlNode,
    source: string,
    root: boolean,
  ): boolean => {
    if (!same(reference.expandedName, node.expandedName)) return false;
    const a = attributes(reference),
      b = attributes(node);
    if (
      a.length !== b.length ||
      a.some((attribute, i) => {
        const other = b[i]!;
        const name =
          attribute.expandedName.namespaceUri === '' &&
          attribute.expandedName.localName === 'Name';
        return (
          !same(attribute.expandedName, other.expandedName) ||
          other.value !== (name ? rename(attribute.value) : attribute.value)
        );
      })
    )
      return false;
    const geometry = (c: XmlNode) =>
      root &&
      c.expandedName.namespaceUri === RDL_2016 &&
      geometryNames.includes(c.expandedName.localName);
    const left = reference.children.filter((c) => !geometry(c)),
      right = node.children.filter((c) => !geometry(c));
    if (left.length !== right.length) return false;
    if (!reference.children.length && !node.children.length)
      return node.text === expectedText(reference, source);
    return left.every((c, i) => compare(c, right[i]!, source, false));
  };
  const insertedIds = new Set<string>();
  for (const entry of expected.inserted) {
    const node = byStart.get(entry.start);
    if (
      !node ||
      !items ||
      node.parentId !== items.id ||
      candidate.snapshot.source.slice(node.range.start, node.range.end) !==
        entry.fragment
    )
      return false;
    const declarations = Object.entries(entry.root.namespaces)
      .filter(([prefix]) => prefix !== 'xml')
      .map(
        ([prefix, uri]) =>
          ` ${prefix ? `xmlns:${prefix}` : 'xmlns'}="${uri.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`,
      )
      .join('');
    const wrapper = `<w${declarations}>${entry.root.xml}</w>`;
    const parsed = parse({
      uri: 'capture:',
      version: 0,
      source: wrapper,
      eol: '\n',
    });
    const reference = parsed.root?.children[0];
    if (
      parsed.status !== 'valid' ||
      !reference ||
      !compare(reference, node, wrapper, true)
    )
      return false;
    const item =
      after.tables.find((t) => t.node.id === node.id) ??
      after.textboxes.find(
        (t) => t.node.id === node.id && t.context === 'body',
      );
    if (
      !item ||
      (entry.root.kind === 'table') !== after.tables.includes(item as never)
    )
      return false;
    const geometry = acceptedGeometry(after, item, entry.root.kind === 'table');
    for (const key of ['left', 'top', 'width', 'height'] as const) {
      const actual = geometry[key].points;
      if (actual === null || Math.abs(actual - entry.bounds[key]) > 0.01)
        return false;
    }
    insertedIds.add(node.id);
  }
  // Allocated identities stay unique among report items, groups and datasets.
  const names: string[] = [];
  const collect = (node: XmlNode) => {
    const name = node.attributes.find(
      (a) =>
        a.expandedName.namespaceUri === '' &&
        a.expandedName.localName === 'Name',
    );
    if (
      name &&
      node.expandedName.namespaceUri === RDL_2016 &&
      !['Field', 'DataSource', 'Parameter', 'ReportParameter'].includes(
        node.expandedName.localName,
      )
    )
      names.push(name.value);
    node.children.forEach(collect);
  };
  if (candidate.root) collect(candidate.root);
  if (new Set(names).size !== names.length) return false;
  const count = (report: ReturnType<typeof projectReport>) => ({
    textboxes: report.textboxes.filter((t) => t.context === 'body').length,
    tables: report.tables.length,
  });
  const removedTables = expected.removed.filter(
    (n) => n.expandedName.localName === 'Tablix',
  ).length;
  const insertedTables = expected.inserted.filter(
    (e) => e.root.kind === 'table',
  ).length;
  const was = count(before),
    now = count(after);
  return (
    now.tables === was.tables - removedTables + insertedTables &&
    now.textboxes ===
      was.textboxes -
        (expected.removed.length - removedTables) +
        (expected.inserted.length - insertedTables)
  );
}
