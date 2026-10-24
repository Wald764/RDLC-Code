import type {
  AcceptedNavigation,
  NavigationNode,
  NavigationProjection,
  NavigationDetails,
} from '@rdlc/report-model/navigation';
import type { XmlNode, XmlSyntaxDocument } from '@rdlc/report-model/syntax';
import {
  fieldTypes,
  DESIGNER_NAMESPACE,
  type ReportProjection,
} from '@rdlc/report-model/report';

const namespaces = new Set(
  ['2003/10', '2005/01', '2008/01', '2010/01', '2016/01'].map(
    (version) =>
      `http://schemas.microsoft.com/sqlserver/reporting/${version}/reportdefinition`,
  ),
);
const kinds: Readonly<Record<string, NavigationNode['kind']>> = {
  Report: 'report',
  ReportSections: 'sections',
  ReportSection: 'section',
  Body: 'body',
  PageHeader: 'header',
  PageFooter: 'footer',
  Textbox: 'textbox',
  Tablix: 'table',
  Table: 'table',
  TablixBody: 'table-body',
  TablixRow: 'table-row',
  TableRow: 'table-row',
  TablixCell: 'table-cell',
  TableCell: 'table-cell',
  TablixMember: 'member',
  Group: 'group',
  TablixHeader: 'member-header',
  Rectangle: 'container',
  List: 'container',
  Matrix: 'container',
};
const wrappers = new Set([
  'ReportItems',
  'Page',
  'TablixRows',
  'TablixCells',
  'CellContents',
  'TablixRowHierarchy',
  'TablixColumnHierarchy',
  'TablixMembers',
  'TableRows',
  'TableCells',
  'Details',
  'Header',
  'Footer',
  'TableGroups',
  'TableGroup',
  'Grouping',
]);
const dataCollections: Readonly<
  Record<string, { element: string; kind: NavigationNode['kind'] }>
> = {
  DataSets: { element: 'DataSet', kind: 'dataset' },
  ReportParameters: { element: 'ReportParameter', kind: 'parameter' },
  EmbeddedImages: { element: 'EmbeddedImage', kind: 'embedded-image' },
  DataSources: { element: 'DataSource', kind: 'data-source' },
};

/** Independent read-only syntax traversal; never broadens the parser's authoring namespace. */
export function projectNavigation(
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
): AcceptedNavigation {
  const structure: NavigationNode[] = [],
    data: NavigationNode[] = [];
  let structureTruncated = false,
    dataTruncated = false;
  const root = syntax.root;
  const version = syntax.snapshot.version;
  if (!root || syntax.status === 'invalid-source')
    return {
      version,
      structure: { nodes: [], truncated: false },
      data: { nodes: [], truncated: false },
    };
  const namespace = root.expandedName.namespaceUri;
  const known =
    root.expandedName.localName === 'Report' && namespaces.has(namespace);
  dataTruncated = !known;
  const editable = report.status === 'editable';
  const authored = new Set([
    ...report.textboxes
      .filter((node) => node.capabilities.length)
      .map((node) => node.node.id),
    ...report.tables
      .filter((node) => node.structural)
      .map((node) => node.node.id),
    ...report.datasets.flatMap((node) => [
      node.node.id,
      ...node.fields.map((field) => field.node.id),
    ]),
  ]);
  const fieldsById = new Map(
    report.datasets.flatMap((dataset) =>
      dataset.fields.map((field) => [field.node.id, field] as const),
    ),
  );
  const ordinals = new Map<string, number>();
  const syntaxNodes = new Map<string, XmlNode>();
  const index = (node: XmlNode) => {
    ordinals.set(node.id, ordinals.size);
    syntaxNodes.set(node.id, node);
    node.children.forEach(index);
  };
  index(root);
  const create = (
    node: XmlNode,
    parentId: string | null,
    kind: NavigationNode['kind'],
    opaque = false,
  ): NavigationNode => {
    const name =
      node.attributes.find(
        (attribute) =>
          attribute.expandedName.namespaceUri === '' &&
          attribute.expandedName.localName === 'Name',
      )?.value ?? null;
    const field = fieldsById.get(node.id);
    const fieldSupported =
      !field ||
      (field.type !== null &&
        field.calculatedValue === null &&
        field.dataField === field.name);
    const eligible =
      editable && authored.has(node.id) && !opaque && fieldSupported;
    const reason = eligible
      ? null
      : editable
        ? 'Preservation-only content; inspect Code XML.'
        : 'Source-only report; inspect Code XML.';
    return {
      id: node.id,
      parentId,
      sourceOrder: ordinals.get(node.id)!,
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
      ...([
        'dataset',
        'field',
        'parameter',
        'embedded-image',
        'data-source',
      ].includes(kind)
        ? { details: metadata(node, kind, namespace, field) }
        : {}),
    };
  };
  const visit = (
    node: XmlNode,
    parentId: string | null,
    depth: number,
  ): void => {
    const local = node.expandedName.localName;
    if (
      node !== root &&
      node.expandedName.namespaceUri === namespace &&
      local in dataCollections
    )
      return;
    const foreign = !known || node.expandedName.namespaceUri !== namespace;
    const item =
      node.parentId !== null &&
      syntaxNodes.get(node.parentId)?.expandedName.localName === 'ReportItems';
    const kind = foreign
      ? 'preserved'
      : (kinds[local] ?? (item ? 'preserved' : undefined));
    if (!kind && !wrappers.has(local)) return;
    if (!kind) {
      node.children.forEach((child) => visit(child, parentId, depth));
      return;
    }
    if (structure.length >= 2000 || depth >= 32) {
      structureTruncated = true;
      return;
    }
    structure.push(
      create(node, parentId, kind, foreign || kind === 'container'),
    );
    if (foreign || kind === 'textbox' || kind === 'preserved') return;
    node.children.forEach((child) => visit(child, node.id, depth + 1));
  };
  visit(root, null, 0);
  if (known)
    for (const collection of root.children) {
      const category = dataCollections[collection.expandedName.localName];
      if (!category || collection.expandedName.namespaceUri !== namespace)
        continue;
      for (const node of collection.children) {
        if (data.length >= 2000) {
          dataTruncated = true;
          break;
        }
        const exact =
          node.expandedName.namespaceUri === namespace &&
          node.expandedName.localName === category.element;
        data.push(create(node, null, exact ? category.kind : 'opaque', !exact));
        if (exact && category.kind === 'dataset')
          for (const fields of node.children.filter(
            (child) =>
              child.expandedName.namespaceUri === namespace &&
              child.expandedName.localName === 'Fields',
          ))
            for (const field of fields.children) {
              if (data.length >= 2000) {
                dataTruncated = true;
                break;
              }
              const exactField =
                field.expandedName.namespaceUri === namespace &&
                field.expandedName.localName === 'Field';
              data.push(
                create(
                  field,
                  node.id,
                  exactField ? 'field' : 'opaque',
                  !exactField,
                ),
              );
            }
      }
    }
  const structureBudget = Math.min(
    structure.length,
    1000 + Math.max(0, 1000 - data.length),
  );
  const dataBudget = Math.min(data.length, 2000 - structureBudget);
  const prefix = (
    nodes: NavigationNode[],
    limit: number,
    truncated: boolean,
  ): NavigationProjection => ({
    nodes: nodes.slice(0, limit),
    truncated: truncated || nodes.length > limit,
  });
  return {
    version,
    structure: prefix(structure, structureBudget, structureTruncated),
    data: prefix(data, dataBudget, dataTruncated),
  };
}

function metadata(
  node: XmlNode,
  kind: NavigationNode['kind'],
  namespace: string,
  field: ReportProjection['datasets'][number]['fields'][number] | undefined,
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
    return {
      ...(type ? { type } : {}),
      classification: child('Value')
        ? 'calculated'
        : child('DataField')?.text !== name
          ? 'mapped'
          : type
            ? 'local'
            : 'unsupported',
    };
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
