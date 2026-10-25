import type {
  ReportStructure,
  StructureNode,
} from '@rdlc/report-model/protocol';
import type { XmlSyntaxDocument, XmlNode } from '@rdlc/report-model/syntax';
import type { ReportProjection } from '@rdlc/report-model/report';

const kinds: Readonly<Record<string, StructureNode['kind']>> = {
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
  TablixRow: 'row',
  TableRow: 'row',
  TablixCell: 'cell',
  TableCell: 'cell',
  TablixMember: 'member',
  TablixHeader: 'member-header',
  Group: 'group',
  Grouping: 'group',
  Rectangle: 'container',
  List: 'container',
  Matrix: 'container',
};
const wrappers = new Set([
  'ReportItems',
  'Page',
  'TablixRowHierarchy',
  'TablixColumnHierarchy',
  'TablixMembers',
  'TablixRows',
  'TablixCells',
  'CellContents',
  'TableRows',
  'TableCells',
  'Details',
  'Header',
  'Footer',
  'TableGroups',
  'TableGroup',
]);
const namespaces = new Set(
  ['2003/10', '2005/01', '2008/01', '2010/01', '2016/01'].map(
    (version) =>
      `http://schemas.microsoft.com/sqlserver/reporting/${version}/reportdefinition`,
  ),
);

/**
 * Read-only structure projection; presentation limits never change parser or
 * authoring eligibility. Datasets/fields belong to the Data projection only.
 */
export function projectStructure(
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
  limit = 2000,
): ReportStructure {
  const nodes: StructureNode[] = [];
  let truncated = false;
  if (!syntax.root || syntax.status === 'invalid-source')
    return { nodes, truncated };
  const namespace = syntax.root.expandedName.namespaceUri;
  const known =
    syntax.root.expandedName.localName === 'Report' &&
    namespaces.has(namespace);
  const supported = new Set([
    ...report.textboxes
      .filter((t) => t.capabilities.length > 0)
      .map((t) => t.node.id),
    ...report.tables.filter((t) => t.structural).map((t) => t.node.id),
  ]);
  const visit = (
    node: XmlNode,
    parentId: string | null,
    depth: number,
    inherited: string | null,
  ): void => {
    const local = node.expandedName.localName;
    const foreign = !known || node.expandedName.namespaceUri !== namespace;
    const item =
      node.parentId !== null &&
      syntaxNodes.get(node.parentId)?.expandedName.localName === 'ReportItems';
    const kind = foreign
      ? 'preserved'
      : (kinds[local] ?? (item ? 'preserved' : null));
    if (!kind && !wrappers.has(local)) return;
    if (!kind) {
      for (const child of node.children)
        visit(child, parentId, depth, inherited);
      return;
    }
    if (nodes.length >= Math.min(2000, limit) || depth >= 32) {
      truncated = true;
      return;
    }
    const preservedReason = inherited
      ? `${inherited} ${node.qualifiedName} remains preservation-only.`
      : foreign ||
          kind === 'preserved' ||
          kind === 'container' ||
          ((kind === 'textbox' || kind === 'table') && !supported.has(node.id))
        ? `${node.qualifiedName} is preserved; inspect source for unsupported content.`
        : null;
    const name =
      node.attributes.find(
        (a) =>
          a.expandedName.namespaceUri === '' &&
          a.expandedName.localName === 'Name',
      )?.value ?? null;
    nodes.push({
      id: node.id,
      parentId,
      kind,
      label: name ? `${local}: ${name}` : local,
      name,
      range: { ...node.range },
      preservedReason,
    });
    if (foreign || kind === 'preserved' || kind === 'textbox') return;
    for (const child of node.children)
      visit(child, node.id, depth + 1, preservedReason);
  };
  const syntaxNodes = new Map<string, XmlNode>();
  const index = (node: XmlNode): void => {
    syntaxNodes.set(node.id, node);
    node.children.forEach(index);
  };
  index(syntax.root);
  visit(
    syntax.root,
    null,
    0,
    report.status === 'editable' ? null : 'Source-only report; inspect source.',
  );
  return { nodes, truncated };
}
