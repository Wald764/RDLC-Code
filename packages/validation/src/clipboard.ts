import type { Capture } from '@rdlc/report-model/clipboard';
import type { Diagnostic } from '@rdlc/report-model/diagnostics';
import type { XmlNode } from '@rdlc/report-model/syntax';
import { RDL_2016, type ReportProjection } from '@rdlc/report-model/report';
import { nextName, validateName } from './validate.js';

export const EXTENSION_NAMESPACE = 'urn:rdlc-code:extension';
const XMLNS = 'http://www.w3.org/2000/xmlns/';

export function clipboardError(
  code: string,
  message: string,
  correctiveAction = 'Inspect the selection in source, or copy a supported selection again.',
): Diagnostic {
  return {
    code,
    message,
    category: 'preservation-risk',
    severity: 'error',
    range: { start: 0, end: 0 },
    correctiveAction,
    blockedOperations: ['requested-edit'],
  };
}

/**
 * The only classified foreign metadata (contracts/clipboard.md): a project-owned
 * `{urn:rdlc-code:extension}Opaque` with exactly `keep="1"` and text-only content.
 * Its text is inert and is never scanned for references.
 */
export function inertAnnotation(node: XmlNode, source: string): boolean {
  if (
    node.expandedName.namespaceUri !== EXTENSION_NAMESPACE ||
    node.expandedName.localName !== 'Opaque' ||
    node.children.length
  )
    return false;
  const attributes = node.attributes.filter(
    (a) => a.expandedName.namespaceUri !== XMLNS,
  );
  if (
    attributes.length !== 1 ||
    attributes[0]!.qualifiedName !== 'keep' ||
    attributes[0]!.value !== '1'
  )
    return false;
  if (!node.closeRange) return true;
  // Text, entities, CDATA and comments only; no processing instruction.
  const inner = source
    .slice(node.openRange.end, node.closeRange.start)
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g, '');
  return !inner.includes('<');
}

/** Typed destination identities; group and data-region names share the scope namespace. */
export interface NameIndex {
  readonly items: ReadonlyMap<string, string>;
  readonly groups: ReadonlySet<string>;
  readonly datasets: ReadonlySet<string>;
}
export function nameIndex(root: XmlNode | null): NameIndex {
  const items = new Map<string, string>();
  const groups = new Set<string>();
  const datasets = new Set<string>();
  const name = (node: XmlNode) =>
    node.attributes.find(
      (a) =>
        a.expandedName.namespaceUri === '' &&
        a.expandedName.localName === 'Name',
    )?.value;
  const visit = (node: XmlNode, inItems: boolean) => {
    const rdl = node.expandedName.namespaceUri === RDL_2016;
    const local = node.expandedName.localName;
    const value = name(node);
    if (rdl && value !== undefined) {
      if (local === 'Group') groups.add(value);
      else if (local === 'DataSet') datasets.add(value);
      else if (inItems) items.set(value, local);
    }
    const nested = inItems || (rdl && local === 'ReportSections');
    for (const child of node.children) visit(child, nested);
  };
  if (root) visit(root, false);
  return { items, groups, datasets };
}

/**
 * Keep a free original name, otherwise a valid generic ASCII prefix plus the
 * lowest free number (the creation series); destination and newly assigned names are reserved together.
 */
export function allocateNames(
  capture: Capture,
  index: NameIndex,
): ReadonlyMap<string, string> {
  const reserved = [...index.items.keys(), ...index.groups, ...index.datasets];
  const names = new Map<string, string>();
  const fallback: Readonly<Record<string, string>> = {
    Textbox: 'Textbox',
    Tablix: 'Table',
    Group: 'Group',
  };
  for (const root of capture.roots)
    for (const identity of root.identities) {
      if (names.has(identity.name))
        throw new Error(`Duplicate copied name ${identity.name}.`);
      let next = identity.name;
      if (!validateName(next, reserved)) {
        const stem = /^[A-Za-z_][A-Za-z0-9_]*$/.test(identity.name)
          ? identity.name.replace(/[0-9]+$/, '')
          : '';
        next = nextName(
          stem || (fallback[identity.element] ?? 'Item'),
          reserved,
        );
        if (!validateName(next, reserved))
          throw new Error(`Cannot allocate a name for ${identity.name}.`);
      }
      names.set(identity.name, next);
      reserved.push(next);
    }
  return names;
}

/**
 * Same dataset name is insufficient: every required field needs an identical
 * definition and known type. External report items need a compatible kind.
 */
export function validateDestination(
  capture: Capture,
  root: XmlNode | null,
  report: ReportProjection,
): readonly Diagnostic[] {
  const fail = (code: string, message: string) => [
    clipboardError(
      code,
      message,
      'Paste into a report with compatible datasets and targets, or copy the dependency too.',
    ),
  ];
  if (report.status !== 'editable' || !report.section || !root)
    return fail('SOURCE_ONLY', 'Fix source diagnostics before pasting.');
  if (capture.schema !== RDL_2016 || report.namespace !== RDL_2016)
    return fail('SCHEMA_INCOMPATIBLE', 'The copied schema differs.');
  for (const required of capture.datasets) {
    const dataset = report.datasets.find((d) => d.name === required.name);
    if (!dataset)
      return fail(
        'DATASET_MISSING',
        `Dataset ${required.name} is not declared in this report.`,
      );
    for (const field of required.fields) {
      const target = dataset.fields.filter((f) => f.name === field.name);
      if (
        target.length !== 1 ||
        target[0]!.dataField !== field.dataField ||
        target[0]!.typeName !== field.typeName ||
        target[0]!.calculatedValue !== null
      )
        return fail(
          'DATASET_INCOMPATIBLE',
          `Field ${required.name}.${field.name} has a different definition or type here.`,
        );
    }
  }
  const index = nameIndex(root);
  const internal = new Set(
    capture.roots.flatMap((r) => r.identities.map((i) => i.name)),
  );
  for (const root of capture.roots)
    for (const reference of root.references) {
      if (internal.has(reference.name)) continue;
      const kind = index.items.get(reference.name);
      if (
        reference.kind === 'scope' ||
        kind !== (reference.kind === 'textbox' ? 'Textbox' : 'Tablix')
      )
        return fail(
          'REFERENCE_UNRESOLVED',
          `${reference.name} is not a compatible ${reference.kind} in this report.`,
        );
    }
  return [];
}
