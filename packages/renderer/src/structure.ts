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
  TablixRow: 'row',
  TableRow: 'row',
  TablixCell: 'cell',
  TableCell: 'cell',
  DataSet: 'dataset',
  Field: 'field',
  Rectangle: 'container',
  List: 'container',
  Matrix: 'container',
};
const wrappers = new Set([
  'ReportItems',
  'Page',
  'DataSets',
  'Fields',
  'TablixBody',
  'TablixRows',
  'TablixCells',
  'CellContents',
  'TableRows',
  'TableCells',
  'Details',
  'Header',
  'Footer',
]);
const ns =
  'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';

/** Read-only navigation projection; presentation limits never change parser or authoring eligibility. */
export function projectStructure(
  syntax: XmlSyntaxDocument,
  report: ReportProjection,
  limit = 2000,
): ReportStructure {
  const nodes: StructureNode[] = [];
  let truncated = false;
  if (!syntax.root || syntax.status === 'invalid-source')
    return { nodes, truncated };
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
    const foreign = node.expandedName.namespaceUri !== ns;
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
    if (
      foreign ||
      kind === 'preserved' ||
      kind === 'textbox' ||
      kind === 'field'
    )
      return;
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
