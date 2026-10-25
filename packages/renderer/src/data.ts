import type {
  NavigationDetails,
  NavigationNode,
  NavigationProjection,
} from '@rdlc/report-model/navigation';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import {
  DESIGNER_NAMESPACE,
  fieldTypes,
  type DatasetField,
  type ReportProjection,
} from '@rdlc/report-model/report';

/**
 * US3 T036/T037 — the bounded, read-only Report Data projector and its fixed
 * presentation categories.
 *
 * Everything is derived from accepted syntax and the existing dataset/field
 * projection: the inert metadata allowlist below is the only text carried, so
 * raw XML, expressions, query text, credentials and image payloads never leave
 * this module, and nothing is decoded, evaluated or fetched. Capability facts
 * mirror the existing guards (recognized field type plus the calculated-field
 * refusal of `apps/vscode-extension/src/edit-controller.ts`), the parser's
 * authoring namespace is never broadened, and categories are presentation-only
 * rows with synthetic keys — never an XML target ID, range or mutation.
 */

const namespaces = new Set(
  ['2003/10', '2005/01', '2008/01', '2010/01', '2016/01'].map(
    (version) =>
      `http://schemas.microsoft.com/sqlserver/reporting/${version}/reportdefinition`,
  ),
);

/** Root collections that own Data definitions; Structure never projects them. */
export const dataCollections: Readonly<
  Record<string, { element: string; kind: NavigationNode['kind'] }>
> = {
  DataSets: { element: 'DataSet', kind: 'dataset' },
  ReportParameters: { element: 'ReportParameter', kind: 'parameter' },
  EmbeddedImages: { element: 'EmbeddedImage', kind: 'embedded-image' },
  DataSources: { element: 'DataSource', kind: 'data-source' },
};

/** Kinds whose closed metadata allowlist applies; opaque definitions stay bare. */
const detailKinds: readonly NavigationNode['kind'][] = [
  'dataset',
  'field',
  'parameter',
  'embedded-image',
  'data-source',
];

/**
 * Fixed synthetic presentation categories: stable UI keys, fixed count and
 * labels, and no XML identity, range or capability of their own.
 */
export const dataCategories = [
  { key: 'datasets', label: 'Datasets / Fields' },
  { key: 'parameters', label: 'Parameters' },
  { key: 'images', label: 'Embedded Images' },
  { key: 'sources', label: 'Data Sources' },
] as const;
export type DataCategoryKey = (typeof dataCategories)[number]['key'];

export interface DataCategoryGroup {
  readonly key: DataCategoryKey;
  readonly label: string;
  /** Nodes of this category in accepted source order, children with their dataset. */
  readonly nodes: readonly NavigationNode[];
}
export interface DataCategories {
  readonly categories: readonly DataCategoryGroup[];
  /** Definitions no supported collection proves a place for; never invented into one. */
  readonly unassigned: readonly NavigationNode[];
}

const kindCategory: Readonly<
  Partial<Record<NavigationNode['kind'], DataCategoryKey>>
> = {
  dataset: 'datasets',
  field: 'datasets',
  parameter: 'parameters',
  'embedded-image': 'images',
  'data-source': 'sources',
};

/**
 * Group one Data projection into its fixed categories. A definition belongs to
 * its known kind, else to the collection its actual ancestors prove, else — for
 * root opaque definitions — to the root collection whose accepted source range
 * really contains it. A foreign lookalike name decides nothing; when no
 * collection proves ownership the definition stays unassigned so the caller
 * reports an incomplete inventory instead of a guessed category.
 */
export function groupDataCategories(
  nodes: readonly NavigationNode[],
  syntax: XmlSyntaxDocument,
): DataCategories {
  const root = syntax.root;
  const namespace = root ? root.expandedName.namespaceUri : '';
  // Known root collections of this very document (any supported profile).
  const collections: {
    readonly range: XmlNode['range'];
    readonly key: DataCategoryKey;
  }[] = [];
  for (const child of root?.children ?? []) {
    if (child.expandedName.namespaceUri !== namespace) continue;
    const entry = dataCollections[child.expandedName.localName];
    const key = entry ? kindCategory[entry.kind] : undefined;
    if (key) collections.push({ range: child.range, key });
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const categories = dataCategories.map((category) => ({
    ...category,
    nodes: [] as NavigationNode[],
  }));
  const unassigned: NavigationNode[] = [];
  for (const node of nodes) {
    let key = kindCategory[node.kind] ?? null;
    for (
      let parent = node.parentId ? byId.get(node.parentId) : undefined;
      !key && parent;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    )
      key = kindCategory[parent.kind] ?? null;
    if (key === null) {
      const collection = collections.find(
        (entry) =>
          entry.range.start <= node.range.start &&
          node.range.end <= entry.range.end,
      );
      key = collection ? collection.key : null;
    }
    const group =
      key === null ? undefined : categories.find((entry) => entry.key === key);
    if (group) group.nodes.push(node);
    else unassigned.push(node);
  }
  return { categories, unassigned };
}

/** Shared accepted facts: one preorder index and one authored/field inventory. */
export interface NavigationFacts {
  readonly namespace: string;
  readonly known: boolean;
  readonly editable: boolean;
  readonly authored: ReadonlySet<string>;
  readonly fieldsById: ReadonlyMap<string, DatasetField>;
  readonly ordinals: ReadonlyMap<string, number>;
  readonly syntaxNodes: ReadonlyMap<string, XmlNode>;
}

/** Single index pass both native projections join; never mutates its inputs. */
export function navigationFacts(
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
): NavigationFacts {
  const root = syntax.root;
  const namespace = root ? root.expandedName.namespaceUri : '';
  const known =
    !!root &&
    root.expandedName.localName === 'Report' &&
    namespaces.has(namespace);
  const ordinals = new Map<string, number>();
  const syntaxNodes = new Map<string, XmlNode>();
  const index = (node: XmlNode): void => {
    ordinals.set(node.id, ordinals.size);
    syntaxNodes.set(node.id, node);
    node.children.forEach(index);
  };
  if (root) index(root);
  return {
    namespace,
    known,
    editable: report.status === 'editable',
    authored: new Set([
      ...report.textboxes
        .filter((node) => node.capabilities.length)
        .map((node) => node.node.id),
      ...report.tables
        .filter((node) => node.structural)
        .map((node) => node.node.id),
      ...report.datasets.flatMap((dataset) => [
        dataset.node.id,
        ...dataset.fields.map((field) => field.node.id),
      ]),
    ]),
    fieldsById: new Map(
      report.datasets.flatMap((dataset) =>
        dataset.fields.map((field) => [field.node.id, field] as const),
      ),
    ),
    ordinals,
    syntaxNodes,
  };
}

/** One accepted node: truthful identity, inert metadata and capability facts. */
export function createNavigationNode(
  facts: NavigationFacts,
  node: XmlNode,
  parentId: string | null,
  kind: NavigationNode['kind'],
  opaque = false,
): NavigationNode {
  const name =
    node.attributes.find(
      (attribute) =>
        attribute.expandedName.namespaceUri === '' &&
        attribute.expandedName.localName === 'Name',
    )?.value ?? null;
  const field = facts.fieldsById.get(node.id);
  const fieldSupported =
    !field || (field.type !== null && field.calculatedValue === null);
  const eligible =
    facts.editable && facts.authored.has(node.id) && !opaque && fieldSupported;
  const reason = eligible
    ? null
    : facts.editable
      ? 'Preservation-only content; inspect Code XML.'
      : 'Source-only report; inspect Code XML.';
  return {
    id: node.id,
    parentId,
    sourceOrder: facts.ordinals.get(node.id)!,
    range: { ...node.range },
    expandedName: `{${node.expandedName.namespaceUri}}${node.expandedName.localName}`,
    name,
    kind,
    label: name
      ? `${node.expandedName.localName}: ${name}`
      : node.expandedName.localName,
    opaqueReason: reason,
    capabilities: [
      { operation: 'inspect', eligible: true, reason: null },
      { operation: 'source', eligible: true, reason: null },
      { operation: 'select', eligible: true, reason: null },
      { operation: 'properties', eligible, reason },
      { operation: 'author', eligible, reason },
    ],
    ...(detailKinds.includes(kind)
      ? { details: details(node, kind, facts.namespace, field) }
      : {}),
  };
}

/**
 * Closed inert metadata allowlist: presence/shape flags and recognized types
 * only — no expression, query, credential, connection or payload content.
 */
function details(
  node: XmlNode,
  kind: NavigationNode['kind'],
  namespace: string,
  field: DatasetField | undefined,
): NavigationDetails {
  const child = (name: string) =>
    node.children.find(
      (child) =>
        child.expandedName.namespaceUri === namespace &&
        child.expandedName.localName === name,
    );
  if (kind === 'dataset') return { hasQuery: !!child('Query') };
  if (kind === 'field') {
    const name = node.attributes.find(
      (attribute) =>
        attribute.expandedName.namespaceUri === '' &&
        attribute.expandedName.localName === 'Name',
    )?.value;
    const typeName = node.children
      .find(
        (child) =>
          child.expandedName.namespaceUri === DESIGNER_NAMESPACE &&
          child.expandedName.localName === 'TypeName',
      )
      ?.text.trim();
    const type =
      field?.type ??
      (Object.entries(fieldTypes).find(
        ([, value]) => value === typeName,
      )?.[0] as NavigationDetails['type']);
    const dataField = child('DataField')?.text;
    // A Value is calculated; without a recognized type, declared name or binding
    // nothing proves a mapping, so the definition stays unsupported.
    const classification = child('Value')
      ? 'calculated'
      : type && name !== undefined && dataField !== undefined
        ? dataField !== name
          ? 'mapped'
          : 'local'
        : 'unsupported';
    return { ...(type ? { type } : {}), classification };
  }
  if (kind === 'embedded-image') {
    const mime = child('MIMEType')?.text.trim();
    return {
      hasPayload: !!child('ImageData')?.text.length,
      ...([
        'image/png',
        'image/jpeg',
        'image/gif',
        'image/bmp',
        'image/tiff',
        'image/svg+xml',
      ].includes(mime ?? '')
        ? { mime: mime as NonNullable<NavigationDetails['mime']> }
        : {}),
    };
  }
  if (kind === 'data-source')
    return {
      source: child('DataSourceReference')
        ? 'shared'
        : child('ConnectionProperties')
          ? 'inline'
          : 'unknown',
    };
  const result: {
    type?: NonNullable<NavigationDetails['type']>;
    nullable?: boolean;
    multiValue?: boolean;
    allowBlank?: boolean;
    hidden?: boolean;
  } = {};
  const type = child('DataType')?.text.trim();
  if (
    ['Boolean', 'String', 'Integer', 'Float', 'DateTime'].includes(type ?? '')
  )
    result.type = type as NonNullable<NavigationDetails['type']>;
  for (const [element, property] of [
    ['Nullable', 'nullable'],
    ['MultiValue', 'multiValue'],
    ['AllowBlank', 'allowBlank'],
    ['Hidden', 'hidden'],
  ] as const) {
    const value = child(element)?.text.trim();
    if (value === 'true' || value === 'false')
      result[property] = value === 'true';
  }
  return result;
}

/**
 * Bounded read-only Data projection joined to the accepted facts: exact source
 * order and ranges, actual dataset/field ancestry, opaque lookalikes kept
 * visible, and an explicit incomplete state whenever a collection that could
 * hold definitions is skipped.
 */
export function projectData(
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
  facts: NavigationFacts = navigationFacts(syntax, report),
): NavigationProjection {
  const root = syntax.root;
  const nodes: NavigationNode[] = [];
  if (!root || syntax.status === 'invalid-source')
    return { nodes, truncated: false };
  const { namespace } = facts;
  let truncated = !facts.known;
  if (facts.known)
    for (const collection of root.children) {
      if (collection.expandedName.namespaceUri !== namespace) {
        // A foreign root collection may hold definitions: report incomplete, never hide it.
        if (collection.children.length > 0) truncated = true;
        continue;
      }
      const entry = dataCollections[collection.expandedName.localName];
      if (!entry) continue;
      for (const node of collection.children) {
        if (nodes.length >= 2000) {
          truncated = true;
          break;
        }
        const exact =
          node.expandedName.namespaceUri === namespace &&
          node.expandedName.localName === entry.element;
        nodes.push(
          createNavigationNode(
            facts,
            node,
            null,
            exact ? entry.kind : 'opaque',
            !exact,
          ),
        );
        if (exact && entry.kind === 'dataset')
          for (const fields of node.children.filter(
            (child) =>
              child.expandedName.namespaceUri === namespace &&
              child.expandedName.localName === 'Fields',
          ))
            for (const field of fields.children) {
              if (nodes.length >= 2000) {
                truncated = true;
                break;
              }
              const exactField =
                field.expandedName.namespaceUri === namespace &&
                field.expandedName.localName === 'Field';
              nodes.push(
                createNavigationNode(
                  facts,
                  field,
                  node.id,
                  exactField ? 'field' : 'opaque',
                  !exactField,
                ),
              );
            }
      }
    }
  return { nodes, truncated };
}
